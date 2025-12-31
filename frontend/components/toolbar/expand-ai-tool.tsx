import { useState } from "react";
import { Expand } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToolbarButton } from "./toolbar-button";

export default function ExpandAITool({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  const [percent, setPercent] = useState<number>(25);
  const [mode, setMode] = useState<"reflect" | "edge" | "solid">("reflect");
  const [color, setColor] = useState<string>("#000000");

  return (
    <ToolbarButton
      icon={Expand}
      label="AI Expand"
      disabled={disabled}
      isPremium={true}
      open={open}
      setOpen={setOpen}
      tool={{
        procedure: "expand_ai",
        params: {
          percent,
          mode,
          ...(mode === "solid" ? { color } : {}),
        },
      }}
    >
      <div className="flex flex-col gap-3 p-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm">Expansão (%)</label>
          <Input
            type="number"
            min={1}
            max={200}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
          />
          <span className="text-xs text-muted-foreground">
            25% costuma ser suficiente para “dar margem” à imagem.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm">Modo</label>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
          >
            <option value="reflect">Reflect (recomendado)</option>
            <option value="edge">Edge</option>
            <option value="solid">Solid color</option>
          </select>
        </div>

        {mode === "solid" && (
          <div className="flex flex-col gap-1">
            <label className="text-sm">Cor</label>
            <Input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#000000"
            />
            <span className="text-xs text-muted-foreground">Formato: #RRGGBB</span>
          </div>
        )}
      </div>
    </ToolbarButton>
  );
}
