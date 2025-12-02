import { ElasticsearchAdmin } from "@/components/admin/ElasticsearchAdmin";

export default function ElasticsearchAdminPage() {
  // Check if running in multi-tenant mode (server-side env var)
  const isMultiTenantMode = process.env.MULTI_TENANT_MODE === "true";

  return (
    <div className="container mx-auto py-8">
      <ElasticsearchAdmin isMultiTenantMode={isMultiTenantMode} />
    </div>
  );
}
