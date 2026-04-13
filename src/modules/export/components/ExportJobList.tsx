"use client";

import { DownloadIcon, CheckCircleIcon, ClockIcon, XCircleIcon, LoaderIcon } from "lucide-react";

type Job = {
  id: string;
  status: string;
  dateFrom: Date;
  dateTo: Date;
  fileSize: number | null;
  expiresAt: Date | null;
  errorMsg: string | null;
  createdAt: Date;
};

type Props = {
  jobs: Job[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("es-VE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "DONE":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          <CheckCircleIcon className="h-3 w-3" />
          Listo
        </span>
      );
    case "PROCESSING":
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          En proceso
        </span>
      );
    case "ERROR":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
          <XCircleIcon className="h-3 w-3" />
          Error
        </span>
      );
    default:
      return null;
  }
}

export function ExportJobList({ jobs }: Props) {
  if (jobs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-lg">Historial de exportaciones</h2>
      <div className="rounded-lg border divide-y">
        {jobs.map((job) => {
          const expired =
            job.expiresAt && new Date(job.expiresAt) < new Date();
          const downloadable = job.status === "DONE" && !expired;

          return (
            <div key={job.id} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium">
                  {formatDate(job.dateFrom)} — {formatDate(job.dateTo)}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <ClockIcon className="h-3 w-3" />
                  {formatDate(job.createdAt)}
                  {job.fileSize && ` · ${formatBytes(job.fileSize)}`}
                  {expired && " · Enlace expirado"}
                </p>
                {job.status === "ERROR" && job.errorMsg && (
                  <p className="text-xs text-destructive">{job.errorMsg}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={job.status} />
                {downloadable && (
                  <a
                    href={`/api/export/download?jobId=${job.id}`}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                    download
                  >
                    <DownloadIcon className="h-3 w-3" />
                    ZIP
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
