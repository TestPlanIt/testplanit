---
sidebar_position: 11
title: Search Configuration
---

# Search Configuration

TestPlanIt uses Elasticsearch for global search across test cases, shared steps, test runs, sessions, projects, issues, and milestones. This page covers connecting TestPlanIt to Elasticsearch, how the indices are built, and how to maintain and troubleshoot them.

Search is optional. When `ELASTICSEARCH_NODE` is not set, global search is unavailable and the rest of the application keeps working.

## Elasticsearch Setup

### Bundled Elasticsearch

The production compose file ships a single-node Elasticsearch service behind a profile:

```bash
docker compose -f docker-compose.prod.yml --profile with-elasticsearch up -d
```

It runs `elasticsearch:9.0.3` as a single node with a 512MB heap and security disabled. See [Docker Setup](./docker-setup.md).

### External Elasticsearch

To use your own cluster, leave the `with-elasticsearch` profile off and point TestPlanIt at the cluster with `ELASTICSEARCH_NODE` (below). TestPlanIt uses the Elasticsearch 9 client.

### Scaling Beyond the Bundled Node

TestPlanIt's own `docker-compose.prod.yml` runs a **single** Elasticsearch node with a 512MB heap and no container memory limit, which is what a normal install needs. The example below is not that configuration — it is a starting point if you have outgrown a single node and want a secured multi-node cluster, and it assumes you add the `elasticsearch2` and `elasticsearch3` services it refers to:

```yaml
elasticsearch:
  image: elasticsearch:9.0.3
  environment:
    - cluster.name=testplanit-cluster
    - node.name=testplanit-node-1
    - discovery.seed_hosts=elasticsearch2,elasticsearch3
    - cluster.initial_master_nodes=testplanit-node-1,testplanit-node-2,testplanit-node-3
    - ES_JAVA_OPTS=-Xms2g -Xmx2g
    - xpack.security.enabled=true
    - xpack.security.transport.ssl.enabled=true
  volumes:
    - elasticsearch_data:/usr/share/elasticsearch/data
    - ./elasticsearch.yml:/usr/share/elasticsearch/config/elasticsearch.yml
  deploy:
    resources:
      limits:
        memory: 4g
      reservations:
        memory: 2g
```

### Environment Configuration

Configure the Elasticsearch connection in your `.env` file:

```env
# Elasticsearch URL. Leave unset to disable search.
ELASTICSEARCH_NODE=http://localhost:9200
```

`ELASTICSEARCH_NODE` is the only connection setting. If the cluster requires credentials, put them in the URL (`https://user:password@host:9200`). In multi-tenant mode, each tenant's `elasticsearchNode` overrides this value — see [Multi-Tenant Workers](./multi-tenant-workers.md).

## Administration Interface

**Administration → Search Engine** (`/admin/elasticsearch`) is available to system administrators. It shows the connection and cluster health, lists each index with its document count, sets the **Number of Replicas**, and runs **Reindex Data**. See [Search Engine](./user-guide/search-engine.md).

## Index Configuration

### Index Structure

TestPlanIt creates one index per entity type:

```text
testplanit-repository-cases    # Test cases
testplanit-shared-steps        # Shared step groups
testplanit-test-runs           # Test runs
testplanit-sessions            # Exploratory sessions
testplanit-projects            # Projects
testplanit-issues              # Issues
testplanit-milestones          # Milestones
```

In multi-tenant mode the tenant ID is part of the name: `testplanit-<tenantId>-repository-cases`, and so on.

### Mappings

TestPlanIt creates the indices and their mappings itself; there is nothing to configure. Every index shares a base mapping — `id`, `projectId`, `projectName`, creator fields, `createdAt`, `updatedAt`, a full-text `searchableContent` field, and nested `customFields` — plus fields specific to the entity type. To inspect the live mapping of an index:

```bash
curl -X GET "localhost:9200/testplanit-repository-cases/_mapping?pretty"
```

When a TestPlanIt upgrade changes a mapping, reindex (see below) so the indices are recreated with the new mapping.

### Index Settings

Each index is created with one primary shard, the standard analyzer with English stop words, and the replica count from **Administration → Search Engine → Number of Replicas**. Use `0` replicas on a single-node cluster; with a higher value the cluster health stays at Warning because the replicas cannot be allocated.

## Indexing Process

### Automatic Indexing

Content is indexed automatically when entities are created or updated, including changes to tags, assignments, and custom field values.

### Manual Reindexing

Reindex after an upgrade that changes the mappings, or to recover from missing documents. From the UI, use **Administration → Search Engine → Reindex Data**, which reindexes all entities or one entity type.

From the command line:

```bash
pnpm elasticsearch:reindex          # reindex every entity type
pnpm elasticsearch:reindex:fresh    # drop and recreate the indices, then reindex
pnpm elasticsearch:reindex:cases    # repository cases only
```

Search results may be incomplete while a reindex runs.

## Search API

Search is served by a single endpoint, `POST /api/search`, which requires a signed-in session. The JSON body carries `filters` (the query text and entity types), and optionally `sort`, `pagination`, `highlight`, and `facets`; facet counts are returned in the same response. See the [API Reference](./api-reference.md) for the full schema.

## Hardware Recommendations

These are for the Elasticsearch service itself, not the whole TestPlanIt stack — see [Docker Setup](./docker-setup.md) for the per-service breakdown of a full install.

The bundled compose files run a single node with a **512MB heap** (`ES_JAVA_OPTS=-Xms512m -Xmx512m`), which is sized for TestPlanIt's index — cases, runs, sessions, issues and milestones — rather than for general-purpose Elasticsearch workloads. Budget **2GB** of memory for the service at minimum and **3GB** for comfort, matching the Docker Setup table; the headroom above the heap covers Lucene's off-heap structures, the JVM itself, and reindex spikes.

Raise the heap only if you have evidence you need it — a large index with slow queries, or heap pressure in the node stats. Elasticsearch's own guidance is to keep the heap at or below 50% of the memory available to the node and never above ~31GB, so a 512MB heap pairs with roughly 1GB or more for the container.

**Storage:** 20GB is ample for a typical install; SSD-backed storage is worth it in production because reindexing and aggregation are I/O-sensitive.

**Scaling out:** separate data and master nodes only become relevant well beyond a single-node install, and TestPlanIt does not require or manage a multi-node topology.

## Monitoring

The status card on **Administration → Search Engine** shows connection, cluster health, node count, and per-index document counts. To query the cluster directly:

```bash
# Cluster status
curl -X GET "localhost:9200/_cluster/health?pretty"

# Index list with document counts and sizes
curl -X GET "localhost:9200/_cat/indices/testplanit-*?v"

# Node information
curl -X GET "localhost:9200/_cat/nodes?v"
```

## Troubleshooting

### Search Is Unavailable

1. Confirm `ELASTICSEARCH_NODE` is set for both the application and the workers, and that the URL is reachable from inside their containers.
2. Open **Administration → Search Engine** and check the connection status.
3. Check the Elasticsearch container or service is running and healthy (`_cluster/health`).
4. Review the application logs for Elasticsearch errors.

### Search Returns No or Missing Results

1. On **Administration → Search Engine**, check the document count for the affected index.
2. Run **Reindex Data** for that entity type (or all entities).
3. Check the workers are running — reindexing runs as a background job. See [Job Queues](./user-guide/queues.md).

### Cluster Health Shows Warning

On a single-node cluster this is almost always unallocated replicas. Set **Number of Replicas** to `0` on the Search Engine page.

### Slow Searches

1. Check heap pressure and CPU on the Elasticsearch node.
2. Use SSD-backed storage.
3. Raise the heap only if node statistics show it is needed (see [Hardware Recommendations](#hardware-recommendations)).

### Diagnostic Commands

```bash
# Statistics for one index
curl -X GET "localhost:9200/testplanit-repository-cases/_stats?pretty"

# Search thread pool activity
curl -X GET "localhost:9200/_cat/thread_pool/search?v&h=node_name,name,active,rejected,completed"
```

## Security

The bundled Elasticsearch runs with security disabled and publishes port 9200 on the host, so keep that port firewalled. For an external or shared cluster:

1. **Enable authentication** on the cluster and give TestPlanIt its own user, with its credentials in the `ELASTICSEARCH_NODE` URL. The user needs full privileges on the `testplanit-*` indices (TestPlanIt creates, deletes, and updates settings on them) and permission to read cluster health:

   ```bash
   curl -X POST "localhost:9200/_security/role/testplanit_search" \
   -u elastic:password \
   -H "Content-Type: application/json" \
   -d '{
     "cluster": ["monitor"],
     "indices": [
       { "names": ["testplanit-*"], "privileges": ["all"] }
     ]
   }'

   curl -X POST "localhost:9200/_security/user/testplanit" \
   -u elastic:password \
   -H "Content-Type: application/json" \
   -d '{ "password": "secure_password", "roles": ["testplanit_search"] }'
   ```

2. **Use TLS** (`https://`) between TestPlanIt and the cluster.
3. **Restrict network access** to the Elasticsearch port so only the application and workers can reach it.

## Backups

The search indices are derived from the database and can always be rebuilt with a reindex, so they do not need to be backed up. Back up PostgreSQL and file storage instead.
