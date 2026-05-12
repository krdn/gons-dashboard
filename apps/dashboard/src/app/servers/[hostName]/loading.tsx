import { ServerOverviewSkeleton } from "@/widgets/server-overview";

export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <ServerOverviewSkeleton />
      <ServerOverviewSkeleton />
    </main>
  );
}
