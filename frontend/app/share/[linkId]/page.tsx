"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { fetchSharedProject, type SharedProject } from "@/lib/projects";
import { useSession } from "@/providers/session-provider";

type Props = {
  params: Promise<{ linkId: string }>;
};

export default function SharePage({ params }: Props) {
  const { linkId } = use(params);
  const session = useSession();

  const [project, setProject] = useState<SharedProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchSharedProject(linkId)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [linkId]);

  if (loading) {
    return (
      <main className="p-8 flex items-center justify-center">
        <div className="inline-flex items-center">
          <span className="animate-spin mr-2">⏳</span>
          <span>Loading...</span>
        </div>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="p-8 space-y-4">
        <h1 className="text-2xl font-semibold">Invalid or revoked link</h1>
        <p className="text-sm text-muted-foreground">
          This share link is no longer valid.
        </p>
        <Link href="/dashboard" className="underline text-blue-500">
          Go back to dashboard
        </Link>
      </main>
    );
  }

  // URL do editor (dashboard do projeto partilhado)
  const editorUrl = `/dashboard/${project._id}?owner=${project.user_id}`;
  const nextParam = encodeURIComponent(editorUrl);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">
        Shared project: {project.name}
      </h1>

      <p className="text-sm">
        Permission: <strong>{project.permission}</strong>
      </p>

      {project.permission === "edit" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This link allows editing. If you log in, you can open this project in the full editor.
          </p>

          {session.user.type !== "anonymous" ? (
            // Já autenticado → abre logo no editor
            <Link
              href={editorUrl}
              className="inline-flex items-center px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Open in editor
            </Link>
          ) : (
            // Anónimo → mostra Login e Register com ?next
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/login?next=${nextParam}`}
                className="inline-flex items-center px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                Login and open
              </Link>
              <Link
                href={`/register?next=${nextParam}`}
                className="inline-flex items-center px-3 py-1.5 rounded bg-muted text-sm hover:bg-muted/80 border border-border"
              >
                Register and open
              </Link>
            </div>
          )}
        </div>
      )}

      {project.imgs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no images.
        </p>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          {project.imgs.map((img) => (
            <div
              key={img._id}
              className="border rounded shadow-sm overflow-hidden"
            >
              <img
                src={img.url}
                alt={img.name}
                className="w-full h-auto object-cover"
              />
              <div className="px-2 py-1 text-xs text-muted-foreground truncate">
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}