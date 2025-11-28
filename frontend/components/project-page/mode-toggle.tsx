"use client";

import { Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";

export function ModeToggle() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  const owner = searchParams.get("owner");
  const router = useRouter();

  const buildUrl = (nextMode: "edit" | "results") => {
    const params = new URLSearchParams();
    params.set("mode", nextMode);
    params.set("view", view);
    if (owner) params.set("owner", owner);
    return `?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-0.5 p-0.5 border rounded-lg">
      <Button
        variant={mode === "edit" ? "default" : "secondary"}
        size="icon"
        onClick={() => router.push(buildUrl("edit"))}
        aria-label="Edit mode"
        aria-pressed={mode === "edit"}
        className="size-8"
        title="Edit mode"
      >
        <Pencil className="h-4 w-4" />
      </Button>

      <Button
        variant={mode === "results" ? "default" : "secondary"}
        size="icon"
        onClick={() => router.push(buildUrl("results"))}
        aria-label="Results mode"
        aria-pressed={mode === "results"}
        className="size-8"
        title="Results mode"
      >
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
}
