"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAssistantSuggest, useReorderProjectTools } from "@/lib/mutations/projects";
import type { ProjectToolResponse } from "@/lib/projects";
import { getErrorMessage } from "@/lib/error-messages";

export function AiAssistantDialog(props: {
  uid: string;
  pid: string;
  token: string;
  ownerId?: string;
  shareId?: string;
  projectVersion: number;
  currentTools: ProjectToolResponse[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const suggest = useAssistantSuggest(
    props.uid,
    props.pid,
    props.token,
    props.ownerId,
    props.shareId,
  );

  const reorder = useReorderProjectTools(
    props.uid,
    props.pid,
    props.token,
    props.ownerId,
    props.shareId,
  );

  const [suggestions, setSuggestions] = useState<
    Array<{ name: string; description: string; tools: ProjectToolResponse[] }>
  >([]);

  const onSend = () => {
    const m = message.trim();
    if (m.length < 2) return;

    suggest.mutate(
      {
        message: m,
        currentTools: props.currentTools,
        projectVersion: props.projectVersion,
      },
      {
        onSuccess: (resp) => {
          setSuggestions(
            (resp.suggestions ?? []).map((s) => ({
              name: s.name,
              description: s.description,
              tools: (s.tools ?? []).map((t, i) => ({
                _id: `tmp-${i}`, // placeholder (server ignora _id no reorder)
                position: i,
                procedure: t.procedure,
                params: t.params,
              })),
            })),
          );
        },
        onError: (err) => {
          const { title, description } = getErrorMessage("assistant-suggest", err);
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  const onApplySuggestion = (tools: ProjectToolResponse[]) => {
  
    // remover _id e garantir posições certinhas
    const toolsNoId = tools.map(({ _id, ...rest }, i) => ({
    ...rest,
    position: i,
  }));

    reorder.mutate(
      { tools: toolsNoId as any, projectVersion: props.projectVersion },
      {
        onSuccess: () => {
          toast({
            title: "Sugestão aplicada",
            description: "A sequência de ferramentas foi atualizada.",
          });
          setOpen(false);
        },
        onError: (err) => {
          const { title, description } = getErrorMessage("project-reorder", err);
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">IA na edição</Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assistente de edição</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder='Ex.: "quero um look vintage"'
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
            }}
            disabled={suggest.isPending}
          />
          <Button onClick={onSend} disabled={suggest.isPending}>
            {suggest.isPending ? "A sugerir..." : "Enviar"}
          </Button>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          {suggestions.map((s, idx) => (
            <Card key={idx} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.description}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  Tools: {s.tools.map((t) => t.procedure).join(" → ")}
                </div>
              </div>
              <Button
                onClick={() => onApplySuggestion(s.tools)}
                disabled={reorder.isPending}
              >
                Aplicar
              </Button>
            </Card>
          ))}

          {suggestions.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Escreve o que pretendes (ex.: “mais cor”, “preto e branco”, “vintage”)
              para receber sugestões.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
