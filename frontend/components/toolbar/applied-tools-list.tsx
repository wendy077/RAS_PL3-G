"use client";

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableToolItem } from "./sortable-tool-item";
import { useProjectInfo, useSetProjectTools } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useReorderProjectTools, useDeleteProjectTool } from "@/lib/mutations/projects";
import { useToast } from "@/hooks/use-toast";

export function AppliedToolsList() {
  const project = useProjectInfo();
  const setTools = useSetProjectTools();
  const session = useSession();
  const reorder = useReorderProjectTools(
    session.user._id,
    project._id,
    session.token,
  );
  const deleteTool = useDeleteProjectTool(
    session.user._id,
    project._id,
    session.token,
  );
  const { toast } = useToast();

  const tools = project.tools;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 }}));

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tools.findIndex((t) => t._id === active.id);
    const newIndex = tools.findIndex((t) => t._id === over.id);

    const sorted = arrayMove(tools, oldIndex, newIndex);

    // garantir que o backend vê a nova ordem
    const withPositions = sorted.map((t, index) => ({
      ...t,
      position: index,
    }));

    // update UI immediately
    setTools(withPositions);

    // update backend positions
    reorder.mutate({
      uid: session.user._id,
      pid: project._id,
      tools: withPositions,
      token: session.token,
    }, {
      onError: (err) => {
        console.error("Erro ao reordenar:", err);
        toast({
          title: "Erro ao reordenar",
          description: "O servidor não conseguiu atualizar a ordem.",
          variant: "destructive"
        })
      }
    });
  }

  function handleRemove(id: string) {
    deleteTool.mutate(
      {
        uid: session.user._id,
        pid: project._id,
        toolId: id,
        token: session.token,
      },
      {
        onSuccess: () => {
          setTools(tools.filter((t) => t._id !== id));
        },
      }
    );
}

  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      <span className="text-xs text-gray-500">Applied</span>

      {tools.length === 0 && (
        <p className="text-[11px] text-gray-400">Nenhuma ferramenta aplicada</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tools.map((t) => t._id)} strategy={verticalListSortingStrategy}>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {tools.map((tool) => (
              <SortableToolItem key={tool._id} tool={tool} onRemove={handleRemove} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
