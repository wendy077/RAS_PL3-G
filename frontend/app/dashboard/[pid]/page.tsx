"use client";

import { Download, LoaderCircle, OctagonAlert, Play } from "lucide-react";
import { ProjectImageList } from "@/components/project-page/project-image-list";
import { ViewToggle } from "@/components/project-page/view-toggle";
import { AddImagesDialog } from "@/components/project-page/add-images-dialog";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/toolbar/toolbar";
import {
  useGetProject,
  useGetProjectResults,
  useGetSocket,
} from "@/lib/queries/projects";
import Loading from "@/components/loading";
import { ProjectProvider } from "@/providers/project-provider";
import { use, useEffect, useLayoutEffect, useState, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSession } from "@/providers/session-provider";
import {
  useDownloadProject,
  useDownloadProjectResults,
  useProcessProject,
  useCancelProjectProcess, // <-- novo
} from "@/lib/mutations/projects";
import { useToast } from "@/hooks/use-toast";
import { ProjectImage } from "@/lib/projects";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Transition } from "@headlessui/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ModeToggle } from "@/components/project-page/mode-toggle";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUpdateSession } from "@/lib/mutations/session";
import { getErrorMessage } from "@/lib/error-messages";

export default function Project({
  params,
}: {
  params: Promise<{ pid: string }>;
}) {
  const resolvedParams = use(params);
  const session = useSession();
  const { pid } = resolvedParams;
  const project = useGetProject(session.user._id, pid, session.token);
  const downloadProjectImages = useDownloadProject();
  const processProject = useProcessProject();
  const cancelProcess = useCancelProjectProcess(); // <-- novo
  const downloadProjectResults = useDownloadProjectResults();
  const { toast } = useToast();
  const socket = useGetSocket(session.token);
  const updateSession = useUpdateSession();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  const router = useRouter();
  const path = usePathname();
  const sidebar = useSidebar();
  const isMobile = useIsMobile();
  const [currentImage, setCurrentImage] = useState<ProjectImage | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingSteps, setProcessingSteps] = useState<number>(1);
  const [waitingForPreview, setWaitingForPreview] = useState<string>("");

  // flag para ignorar updates depois de cancelar
  const ignoreUpdatesRef = useRef(false);

  const totalProcessingSteps =
    (project.data?.tools.length ?? 0) * (project.data?.imgs.length ?? 0);
  const projectResults = useGetProjectResults(
    session.user._id,
    pid,
    session.token,
  );
  const qc = useQueryClient();

  useLayoutEffect(() => {
    if (
      !["edit", "results"].includes(mode) ||
      !["grid", "carousel"].includes(view)
    ) {
      router.replace(path);
    }
  }, [mode, view, path, router, projectResults.data]);

  useEffect(() => {
    function onProcessUpdate() {
      
      // se já cancelámos ou já não estamos em processamento, ignora tudo
      if (ignoreUpdatesRef.current || !processing) return;

      setProcessingSteps((prev) => {
        const nextSteps = prev + 1;

        const progress =
          totalProcessingSteps > 0
            ? Math.min(Math.round((nextSteps * 100) / totalProcessingSteps), 100)
            : 100;

        setProcessingProgress(progress);

        if (nextSteps >= totalProcessingSteps) {
          setTimeout(() => {

            // se entretanto cancelámos, não faz mais nada
            if (ignoreUpdatesRef.current) return;

            projectResults.refetch().then(() => {
              setProcessing(false);
              if (!isMobile) sidebar.setOpen(true);
              setProcessingProgress(0);
              setProcessingSteps(1);
              router.push("?mode=results&view=grid");
            });
          }, 2000);
        }

        return nextSteps;
      });
    }

    function onProcessError(payload: { error_code: string; error_msg: string }) {
      console.error("process-error", payload);
      setProcessing(false);
      setProcessingProgress(0);
      setProcessingSteps(1);
      toast({
        title: "Falha no processamento",
        description:
          payload?.error_msg ||
          "Ocorreu um erro ao processar o projeto. Tenta novamente.",
        variant: "destructive",
      });
    }

    let active = true;

    if (active && socket.data) {
      socket.data.on("process-update", onProcessUpdate);
      socket.data.on("process-error", onProcessError);
    }

    return () => {
      active = false;
      if (socket.data) {
        socket.data.off("process-update", onProcessUpdate);
        socket.data.off("process-error", onProcessError);
      }
    };
  }, [
    pid,
    qc,
    router,
    session.token,
    session.user._id,
    socket.data,
    totalProcessingSteps,
    sidebar,
    isMobile,
    projectResults,
    toast,
    processing
  ]);

  if (project.isError)
    return (
      <div className="flex size-full justify-center items-center h-screen p-8">
        <Alert
          variant="destructive"
          className="w-fit max-w-[40rem] text-wrap truncate"
        >
          <OctagonAlert className="size-4" />
          <AlertTitle>{project.error.name}</AlertTitle>
          <AlertDescription>{project.error.message}</AlertDescription>
        </Alert>
      </div>
    );

  if (
    project.isLoading ||
    !project.data ||
    projectResults.isLoading ||
    !projectResults.data
  )
    return (
      <div className="flex justify-center items-center h-screen">
        <Loading />
      </div>
    );

const handleCancel = () => {
  // ignorar updates vindos do socket
  ignoreUpdatesRef.current = true;

  // parar tudo no UI
  setProcessing(false);
  setProcessingProgress(0);
  setProcessingSteps(1);

  // reabrir a sidebar em desktop 
  if (!isMobile) {
    sidebar.setOpen(true);
  }

  // limpar estado de preview (se alguma tool estava a fazer preview)
  setWaitingForPreview("");
  
  // cancelar no backend
  cancelProcess.mutate(
    {
      uid: session.user._id,
      pid: project.data._id,
      token: session.token,
    },
    {
      onSuccess: () => {
        // voltar a ir buscar a sessão para atualizar remaining_operations
        updateSession.mutate({
          userId: session.user._id,
          token: session.token,
        });

        toast({
          title: "Processamento cancelado",
          description:
            "O processamento deste projeto foi cancelado. Podes ajustar as ferramentas e voltar a tentar.",
        });
      },
      
      onError: (error) => {
        const { title, description } = getErrorMessage(
          "project-cancel-process",
          error,
        );
        toast({
          title,
          description,
          variant: "destructive",
        });
      },
    },
  );
};
  
  return (
    <ProjectProvider
      project={project.data}
      currentImage={currentImage}
      preview={{ waiting: waitingForPreview, setWaiting: setWaitingForPreview }}
    >
      <div className="flex flex-col h-screen relative">
        {/* Header */}
        <div className="flex flex-col xl:flex-row justify-center items-start xl:items-center xl:justify-between border-b border-sidebar-border py-2 px-2 md:px-3 xl:px-4 h-fit gap-2">
          <div className="flex items-center justify-between w-full xl:w-auto gap-2">
            <h1 className="text-lg font-semibold truncate">
              {project.data.name}
            </h1>
            <div className="flex items-center gap-2 xl:hidden">
              <ViewToggle />
              <ModeToggle />
            </div>
          </div>
          <div className="flex items-center justify-between w-full xl:w-auto gap-2">
            <SidebarTrigger variant="outline" className="h-9 w-10 lg:hidden" />
            <div className="flex items-center gap-2 flex-wrap justify-end xl:justify-normal w-full xl:w-auto">
              {mode !== "results" && (
                <>
                  <Button
                    disabled={
                      project.data.tools.length <= 0 || waitingForPreview !== ""
                    }
                    className="inline-flex"
                    onClick={() => {
                      processProject.mutate(
                        {
                          uid: session.user._id,
                          pid: project.data._id,
                          token: session.token,
                        },
                        {
                          onSuccess: () => {
                            ignoreUpdatesRef.current = false;   // certifica que vamos aceitar updates
                            setProcessing(true);
                            sidebar.setOpen(false);
                          
                          updateSession.mutate({
                            userId: session.user._id,
                            token: session.token,
                          });
                        },
                          onError: (error: unknown) => {
                            const { title, description } = getErrorMessage("project-process", error);
                            toast({
                              title,
                              description,
                              variant: "destructive",
                            });
                          },
                        },
                      );
                    }}
                  >
                    <Play /> Apply
                  </Button>
                  <AddImagesDialog />
                </>
              )}
              <Button
                variant="outline"
                className="px-3"
                title="Download project"
                onClick={() => {
                  (mode === "edit"
                    ? downloadProjectImages
                    : downloadProjectResults
                  ).mutate(
                    {
                      uid: session.user._id,
                      pid: project.data._id,
                      token: session.token,
                      projectName: project.data.name,
                    },
                    {
                      onSuccess: () => {
                        toast({
                          title: `Project ${project.data.name} downloaded.`,
                        });
                      },
                    },
                  );
                }}
              >
                {(mode === "edit"
                  ? downloadProjectImages
                  : downloadProjectResults
                ).isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Download />
                )}
              </Button>
              <div className="hidden xl:flex items-center gap-2">
                <ViewToggle />
                <ModeToggle />
              </div>
            </div>
          </div>
        </div>
        {/* Main Content */}
        <div className="h-full overflow-x-hidden flex">
          {mode !== "results" && <Toolbar />}
          <ProjectImageList
            setCurrentImageId={setCurrentImage}
            results={projectResults.data}
          />
        </div>
      </div>
      <Transition
        show={processing}
        enter="transition-opacity ease-in duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-out duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div className="absolute top-0 left-0 h-screen w-screen bg-black/70 z-50 flex justify-center items-center">
          <Card className="p-4 flex flex-col justify-center items-center gap-4">
            <div className="flex gap-2 items-center text-lg font-semibold">
              <h1>Processing</h1>
              <LoaderCircle className="size-[1em] animate-spin" />
            </div>
            <Progress value={processingProgress} className="w-96" />

            <Button
              variant="outline"
              disabled={cancelProcess.isPending}
              onClick={handleCancel}
            >
              {cancelProcess.isPending ? (
                <LoaderCircle className="size-[1em] animate-spin" />
              ) : (
                "Cancelar"
              )}
            </Button>
          </Card>
        </div>
      </Transition>
    </ProjectProvider>
  );
}
