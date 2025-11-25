"use client";

import { ProjectImage, SingleProject, ProjectToolResponse } from "@/lib/projects";
import { createContext, useContext, useState, useEffect } from "react";

interface ProjectContextData {
  project: SingleProject;
  setProjectTools: (tools: ProjectToolResponse[]) => void;
  currentImage: ProjectImage | null;
  preview: {
    waiting: string;
    setWaiting: (waiting: string) => void;
  };
}

const ProjectContext = createContext<ProjectContextData | undefined>(undefined);

export function ProjectProvider({
  children,
  project,
  currentImage,
  preview,
}: {
  children: React.ReactNode;
  project: SingleProject;
  currentImage: ProjectImage | null;
  preview: {
    waiting: string;
    setWaiting: (waiting: string) => void;
  };
}) {
  const [tools, setTools] = useState(project.tools);

  //  manter state tools alinhado com o project vindo do backend
  useEffect(() => {
    setTools(project.tools);
  }, [project.tools]);

  return (
    <ProjectContext.Provider
      value={{
        project: { ...project, tools },
        setProjectTools: setTools,
        currentImage,
        preview,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectInfo() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjectInfo() must be used within a ProjectProvider");
  }
  return context.project;
}

export function useSetProjectTools() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useSetProjectTools() must be used within a ProjectProvider");
  }
  return context.setProjectTools;
}

export function useCurrentImage() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useCurrentImage() must be used within a ProjectProvider");
  }
  return context.currentImage;
}

export function usePreview() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("usePreview() must be used within a ProjectProvider");
  }
  return context.preview;
}
