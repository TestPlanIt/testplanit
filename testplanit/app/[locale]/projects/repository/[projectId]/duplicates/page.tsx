import { DuplicateResultsTable } from "@/components/duplicates/DuplicateResultsTable";

export default async function DuplicatesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Duplicate Candidates</h1>
        <p className="text-muted-foreground">
          Review potential duplicate test cases found during the last scan.
        </p>
      </div>
      <DuplicateResultsTable projectId={projectId} />
    </div>
  );
}
