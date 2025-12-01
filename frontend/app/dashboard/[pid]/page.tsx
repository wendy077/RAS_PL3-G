"use client";

import { Download, LoaderCircle, OctagonAlert, Play } from "lucide-react";
import { ProjectImageList } from "@/components/project-page/project-image-list";
import { ViewToggle } from "@/components/project-page/view-toggle";
import { AddImagesDialog } from "@/components/project-page/add-images-dialog";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/toolbar/toolbar";
import { ShareProjectDialog } from "@/components/projects/share-dialog";
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
  useCancelProjectProcess,
  useDownloadProjectPdf,         
} from "@/lib/mutations/projects";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"; // shadcn / radix menu
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
  const { toast } = useToast();
  const socket = useGetSocket(session.token);
  const updateSession = useUpdateSession();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  // se vier ?owner=... usamos esse userId, senão usamos o próprio utilizador (owner normal)
  const ownerId = searchParams.get("owner") ?? session.user._id;
  const project = useGetProject(session.user._id, pid, session.token, ownerId);
  const downloadProjectImages = useDownloadProject();
  const processProject = useProcessProject();
  const cancelProcess = useCancelProjectProcess(); 
  const downloadProjectResults = useDownloadProjectResults();
  const downloadProjectPdf = useDownloadProjectPdf();
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

  // início do processamento
  const processStartTimeRef = useRef<number | null>(null);

  // se um processamento envolve ferramentas de IA ou não
  const processIsAiRef = useRef<boolean>(false);

  const totalProcessingSteps =
    (project.data?.tools.length ?? 0) * (project.data?.imgs.length ?? 0);
  const projectResults = useGetProjectResults(
    session.user._id,
    pid,
    session.token,
    ownerId,
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
          if (ignoreUpdatesRef.current) {
            // cancelar medição
            processStartTimeRef.current = null;
            processIsAiRef.current = false;
            return;
          }

          const startedAt = processStartTimeRef.current;
          const isAiProcess = processIsAiRef.current;

          // limpar medição
          processStartTimeRef.current = null;
          processIsAiRef.current = false;

          projectResults.refetch().then(() => {
            if (ignoreUpdatesRef.current) return;

            setProcessing(false);
            if (!isMobile) sidebar.setOpen(true);
            setProcessingProgress(0);
            setProcessingSteps(1);
            const params = new URLSearchParams();
            params.set("mode", "results");
            params.set("view", "grid");
            const ownerFromQuery = searchParams.get("owner");
            if (ownerFromQuery) params.set("owner", ownerFromQuery);

            router.push(`?${params.toString()}`);

            if (startedAt != null) {
              const durationMs = performance.now() - startedAt;
              const seconds = durationMs / 1000;
              const perStep =
                totalProcessingSteps > 0
                  ? durationMs / totalProcessingSteps
                  : undefined;

              console.log(
                `[Perf] Processamento ${
                  isAiProcess ? "IA" : "normal"
                } concluído em ${seconds.toFixed(2)}s (${totalProcessingSteps} passos${
                  perStep ? ` ~${perStep.toFixed(0)}ms/pass` : ""
                })`,
              );

              // limiares diferentes: 5s filtros normais, 60s IA
              const NORMAL_THRESHOLD_MS = 5000; // 5s
              const AI_THRESHOLD_MS = 60000; // 60s

              const threshold = isAiProcess
                ? AI_THRESHOLD_MS
                : NORMAL_THRESHOLD_MS;

              if (durationMs > threshold) {
                toast({
                  title: isAiProcess
                    ? "Processamento de IA demorado"
                    : "Processamento demorado",
                  description: isAiProcess
                    ? `Este processamento com ferramentas de IA demorou ${seconds.toFixed(
                        1,
                      )} segundos. Isto ainda está dentro do limite aceitável para IA (até 1 minuto), mas foi mais lento do que o esperado.`
                    : `Este processamento demorou ${seconds.toFixed(
                        1,
                      )} segundos, acima do objetivo de 5 segundos para filtros normais.`,
                });
              }
            }
          });
        }, 2000);
      }

      return nextSteps;
    });
  }

  function onProcessError(payload: { error_code: string; error_msg: string }) {
    if (processStartTimeRef.current !== null) {
      const durationMs = performance.now() - processStartTimeRef.current;
      console.error(
        `[Perf] Processamento ${
          processIsAiRef.current ? "IA" : "normal"
        } falhou após ${(durationMs / 1000).toFixed(2)}s (código ${
          payload?.error_code ?? "N/A"
        })`,
      );
      processStartTimeRef.current = null;
      processIsAiRef.current = false;
    }

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
  processing,
]);

  if (project.isError) {
    const { title, description } = getErrorMessage(
      "project-load",
      project.error,
    );

    return (
      <div className="flex size-full justify-center items-center h-screen p-8">
        <Alert
          variant="destructive"
          className="w-fit max-w-[40rem] text-wrap truncate"
        >
          <OctagonAlert className="size-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      </div>
    );
  }

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

  // cancelar medição de tempo e tipo
  processStartTimeRef.current = null;
  processIsAiRef.current = false;

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
      ownerId,
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
                      project.data.tools.length <= 0 ||
                      waitingForPreview !== ""
                    }
                    className="inline-flex"
                    onClick={() => {
                      // começa a contar o tempo
                      processStartTimeRef.current = performance.now();

                      const aiProcedures = [
                        "bg_remove_ai",
                        "cut_ai",
                        "obj_ai",
                        "people_ai",
                        "text_ai",
                        "upgrade_ai",
                      ];

                      processIsAiRef.current = project.data.tools.some((t) =>
                        aiProcedures.includes(t.procedure),
                      );

                      processProject.mutate(
                        {
                          uid: session.user._id,
                          pid: project.data._id,
                          token: session.token,
                          ownerId,
                        },
                        {
                          onSuccess: () => {
                            ignoreUpdatesRef.current = false;
                            setProcessing(true);
                            sidebar.setOpen(false);

                            updateSession.mutate({
                              userId: session.user._id,
                              token: session.token,
                            });
                          },
                          onError: (error: unknown) => {
                            if (processStartTimeRef.current !== null) {
                              const durationMs =
                                performance.now() - processStartTimeRef.current;
                              console.error(
                                `[Perf] Processamento ${
                                  processIsAiRef.current ? "IA" : "normal"
                                } falhou logo no arranque após ${
                                  (durationMs / 1000).toFixed(2)
                                }s`,
                              );
                              processStartTimeRef.current = null;
                              processIsAiRef.current = false;
                            }

                            const { title, description } = getErrorMessage(
                              "project-process",
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
                    }}
                  >
                    <Play /> Apply
                  </Button>

                  <AddImagesDialog />

                {/* botão Share só para o owner */}
                {session.user._id === ownerId && (
                  <ShareProjectDialog projectId={project.data._id} />
                )}
                </>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="px-3"
                    title="Download project"
                    disabled={
                      downloadProjectImages.isPending ||
                      downloadProjectResults.isPending ||
                      downloadProjectPdf.isPending
                    }
                  >
                    {downloadProjectImages.isPending ||
                    downloadProjectResults.isPending ||
                    downloadProjectPdf.isPending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                        </Button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
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
                                ownerId,
                              },
                              {
                                onSuccess: () => {
                                  toast({
                                    title:
                                      mode === "edit"
                                        ? `Project ${project.data.name} downloaded as ZIP.`
                                        : `Results for ${project.data.name} downloaded as ZIP.`,
                                  });
                                },
                              },
                            );
                          }}
                          disabled={
                            downloadProjectImages.isPending || downloadProjectResults.isPending
                          }
                        >
                          {mode === "edit"
                            ? "Download images (ZIP)"
                            : "Download results (ZIP)"}
                        </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => {
                              downloadProjectPdf.mutate(
                                {
                                  uid: session.user._id,
                                  pid: project.data._id,
                                  token: session.token,
                                  ownerId,
                                  // em results queremos as EDITADAS, em edit queremos as originais
                                  useResults: mode === "results",
                                },
                                {
                                  onSuccess: () => {
                                    toast({
                                      title:
                                        mode === "results"
                                          ? `Results for ${project.data.name} downloaded as PDF.`
                                          : `Project ${project.data.name} downloaded as PDF.`,
                                    });
                                  },
                                },
                              );
                            }}
                            disabled={downloadProjectPdf.isPending}
                          >
                            {mode === "results"
                              ? "Download results (PDF)"
                              : "Download images (PDF)"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

              <div className="hidden xl:flex items-center gap-2">
                <ViewToggle />
                <ModeToggle />
              </div>
            </div>
          </div>
        </div>
        {/* Main Content */}

        <div className="h-full overflow-x-hidden flex">
        <Toolbar />
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