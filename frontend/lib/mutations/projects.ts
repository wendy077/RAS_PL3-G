import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addProject,
  addProjectImages,
  addProjectTool,
  clearProjectTools,
  deleteProject,
  deleteProjectImages,
  deleteProjectTool,
  downloadProjectImages,
  downloadProjectImage,
  downloadProjectResults,
  processProject,
  updateProject,
  updateProjectTool,
  previewProjectImage,
} from "../projects";
import { createBlobUrlFromFile, downloadBlob } from "../utils";
import { validateSession, SessionData } from "../session";


export const useAddProject = (uid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
    },
  });
};

export const useDeleteProject = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectImages", pid],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};

export const useUpdateProject = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
    },
  });
};

export const useAddProjectImages = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addProjectImages,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectImages", uid, pid, token],
      });
    },
  });
};

export const useDeleteProjectImages = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProjectImages,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectImages", uid, pid, token],
      });
    },
  });
};

export const useDownloadProjectImage = (edited?: boolean) => {
  return useMutation({
    mutationFn: downloadProjectImage,
    onSuccess: async (image) => {
      const blobUrl = await createBlobUrlFromFile(image.file);
      downloadBlob(
        edited ? image.name.split(".")[0] + "_edited" : image.name,
        blobUrl,
      );
    },
  });
};

export const useDownloadProject = () => {
  return useMutation({
    mutationFn: downloadProjectImages,
    onSuccess: async (project) => {
      const blobUrl = await createBlobUrlFromFile(project.file);
      downloadBlob(project.name, blobUrl);
    },
  });
};

export const useDownloadProjectResults = () => {
  return useMutation({
    mutationFn: downloadProjectResults,
    onSuccess: async (project) => {
      const blobUrl = await createBlobUrlFromFile(project.file);
      downloadBlob(project.name + "_edited", blobUrl);
    },
  });
};

export const useProcessProject = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: processProject,
    onSuccess: async () => {
      const raw = localStorage.getItem("session");

      if (!raw) {
        // Se não houver sessão, pelo menos limpamos a query "session"
        qc.invalidateQueries({ refetchType: "all", queryKey: ["session"] });
        return;
      }

      try {
        const current = JSON.parse(raw) as SessionData;

        // Chama o backend para obter user + remaining_operations atualizados
        const updated = await validateSession({
          userId: current.user._id,
          token: current.token,
        });

        const newSession: SessionData = {
          user: updated.user,
          token: updated.token,
        };

        // Guarda a sessão nova no localStorage
        localStorage.setItem("session", JSON.stringify(newSession));

        // 2) Atualiza diretamente a cache da query "session"
        qc.setQueryData(["session"], newSession);

        window.dispatchEvent(new Event("session-updated"));

      } catch (err) {
        console.error("Error updating session after processing project:", err);
        qc.invalidateQueries({ refetchType: "all", queryKey: ["session"] });
      }
    },
  });
};

export const useAddProjectTool = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addProjectTool,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};

export const usePreviewProjectResult = () => {
  return useMutation({
    mutationFn: previewProjectImage,
  });
};

export const useUpdateProjectTool = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProjectTool,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};

export const useDeleteProjectTool = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProjectTool,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", uid, pid, token] });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};

export const useClearProjectTools = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearProjectTools,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", uid, pid, token] });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};
