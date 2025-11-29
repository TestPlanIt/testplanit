---
sidebar_position: 11
title: Search Configuration
---

# Search Configuration

TestPlanIt uses Elasticsearch to provide powerful, fast search capabilities across all your test management data. This document covers how to configure, optimize, and troubleshoot the search system.

## Overview

The search system provides:

- **Full-text search** across all entities and content
- **Faceted filtering** with dynamic filter options
- **Real-time indexing** of new and updated content
- **Advanced query capabilities** with highlighting and relevance scoring
- **Scalable performance** for large datasets

## Elasticsearch Setup

### Installation Options

#### Docker Setup (Recommended)

Add Elasticsearch to your Docker Compose configuration:

```yaml
version: '3.8'
services:
  elasticsearch:
    image: elasticsearch:9.0.3
    container_name: testplanit-elasticsearch
    environment:
      - discovery.type=single-node
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
      - xpack.security.enabled=false
      - xpack.security.enrollment.enabled=false
    ports:
      - "9200:9200"
      - "9300:9300"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

volumes:
  elasticsearch_data:
```

#### Production Setup

For production environments:

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

Configure Elasticsearch connection in your `.env` file:

```env
# Elasticsearch Configuration
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX_PREFIX=testplanit_
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your_password

# Optional: SSL Configuration
ELASTICSEARCH_SSL_VERIFY=false
ELASTICSEARCH_SSL_CA_PATH=/path/to/ca.crt

# Performance Settings
ELASTICSEARCH_REQUEST_TIMEOUT=30000
ELASTICSEARCH_MAX_RETRIES=3
ELASTICSEARCH_BULK_SIZE=1000
```

## Administration Interface

### Elasticsearch Admin Panel

TestPlanIt provides a dedicated administration interface for managing Elasticsearch configuration and performing maintenance tasks directly from the web UI.

**Accessing the Admin Panel:**

Navigate to `/admin/elasticsearch` (requires admin privileges)

**Available Features:**

#### Connection Management

- **View Connection Status**: Real-time connection status to Elasticsearch cluster
- **Test Connection**: Verify connectivity and authentication
- **Update Settings**: Modify Elasticsearch URL and credentials without restarting

#### Index Management

- **View All Indices**: List all TestPlanIt indices with their status
- **Index Statistics**: View document counts, size, and health for each index
- **Create Indices**: Initialize missing indices with proper mappings
- **Delete Indices**: Remove indices when needed (with confirmation)
- **Reindex Data**: Trigger full or partial reindexing operations

#### Maintenance Operations

- **Force Merge**: Optimize indices for better search performance
- **Clear Cache**: Clear field data and query caches
- **Refresh Indices**: Force refresh to make recent changes searchable
- **Update Mappings**: Apply new field mappings to existing indices

#### Monitoring Dashboard

- **Cluster Health**: Overall cluster status (green/yellow/red)
- **Node Statistics**: CPU, memory, and disk usage per node
- **Search Metrics**: Query performance and latency statistics
- **Indexing Rate**: Documents indexed per second
- **Error Logs**: Recent Elasticsearch errors and warnings

#### Bulk Operations

- **Bulk Reindex**: Reindex all content with progress tracking
- **Batch Size Configuration**: Adjust batch sizes for optimal performance
- **Selective Reindexing**: Reindex specific projects or entity types
- **Schedule Reindexing**: Set up automated reindexing schedules

**Security Considerations:**

- Admin panel access is restricted to users with `ADMIN` access level
- All operations are logged for audit purposes
- Destructive operations require confirmation
- Connection credentials are encrypted at rest

## Index Configuration

### Index Structure

TestPlanIt creates separate indices for each entity type:

```text
testplanit_repository_cases    # Test cases
testplanit_shared_steps       # Shared step groups
testplanit_test_runs          # Test execution runs
testplanit_sessions           # Exploratory testing sessions
testplanit_projects           # Projects
testplanit_issues             # Issue tracking
testplanit_milestones         # Project milestones
```

### Mapping Configuration

Each index uses optimized field mappings:

```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "standard",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "standard"
      },
      "content": {
        "type": "text",
        "analyzer": "standard"
      },
      "tags": { "type": "keyword" },
      "projectId": { "type": "keyword" },
      "createdAt": { "type": "date" },
      "updatedAt": { "type": "date" },
      "customFields": {
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "value": { "type": "text" }
        }
      }
    }
  }
}
```

### Index Settings

Optimize performance with appropriate settings:

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "testplanit_analyzer": {
          "tokenizer": "standard",
          "filter": ["lowercase", "stop", "snowball"]
        }
      }
    },
    "max_result_window": 50000
  }
}
```

## Indexing Process

### Automatic Indexing

Content is automatically indexed when:

- **Creating** new entities
- **Updating** existing entities
- **Changing** entity relationships (tags, assignments)
- **Modifying** custom field values

### Manual Reindexing

Force complete reindexing when needed:

```bash
# Reindex all entities
pnpm search:reindex

# Reindex specific entity type
pnpm search:reindex --type=repository_cases

# Reindex specific project
pnpm search:reindex --project=project-uuid
```

### Bulk Indexing

For initial setup or large data migrations:

```bash
# Bulk index with progress tracking
pnpm search:bulk-index --batch-size=500 --verbose

# Index with specific time range
pnpm search:bulk-index --from=2024-01-01 --to=2024-12-31
```

## Search API

### Basic Search

```http
GET /api/search?q=login%20test&type=repository_cases&project=uuid
```

Parameters:

- `q`: Search query string
- `type`: Entity type filter (optional)
- `project`: Project filter (optional)
- `limit`: Number of results (default: 25)
- `offset`: Pagination offset (default: 0)

### Advanced Search

```http
POST /api/search
Content-Type: application/json

{
  "query": {
    "multi_match": {
      "query": "user authentication",
      "fields": ["title^2", "description", "content"]
    }
  },
  "filters": {
    "type": ["repository_cases", "sessions"],
    "tags": ["authentication", "security"],
    "projectId": "project-uuid",
    "dateRange": {
      "field": "createdAt",
      "from": "2024-01-01",
      "to": "2024-12-31"
    }
  },
  "sort": [
    { "_score": { "order": "desc" } },
    { "updatedAt": { "order": "desc" } }
  ],
  "highlight": {
    "fields": {
      "title": {},
      "description": {},
      "content": {}
    }
  }
}
```

### Faceted Search

Get aggregated filter options:

```http
GET /api/search/facets?type=repository_cases&project=uuid
```

Response:

```json
{
  "facets": {
    "tags": {
      "authentication": 45,
      "security": 32,
      "login": 28
    },
    "folders": {
      "/Authentication": 67,
      "/Security": 43,
      "/User Management": 34
    },
    "templates": {
      "Test Case Template": 89,
      "Security Test Template": 23
    },
    "states": {
      "Ready": 45,
      "In Progress": 23,
      "Completed": 12
    }
  }
}
```

## Performance Optimization

### Index Optimization

1. **Refresh Interval**: Adjust for write-heavy workloads

   ```json
   {
     "settings": {
       "refresh_interval": "30s"
     }
   }
   ```

2. **Merge Policy**: Optimize for your use case

   ```json
   {
     "settings": {
       "merge.policy.max_merged_segment": "5gb",
       "merge.policy.segments_per_tier": 10
     }
   }
   ```

3. **Field Data Cache**: Configure memory usage

   ```json
   {
     "settings": {
       "indices.fielddata.cache.size": "40%"
     }
   }
   ```

### Query Optimization

1. **Use Filters**: Prefer filters over queries when possible
2. **Limit Fields**: Use `_source` filtering to reduce payload
3. **Pagination**: Use `search_after` for deep pagination
4. **Aggregations**: Cache frequently used aggregations

### Hardware Recommendations

**Development Environment:**

- 2 CPU cores
- 4GB RAM
- 20GB storage

**Production Environment:**

- 4+ CPU cores
- 8GB+ RAM (50% for Elasticsearch heap)
- SSD storage
- Separate data and master nodes for scale

## Monitoring and Maintenance

### Health Monitoring

Check cluster health:

```bash
# Cluster status
curl -X GET "localhost:9200/_cluster/health?pretty"

# Index statistics
curl -X GET "localhost:9200/_cat/indices?v"

# Node information
curl -X GET "localhost:9200/_cat/nodes?v"
```

### Performance Metrics

Monitor key metrics:

- **Search latency**: Average response time
- **Indexing rate**: Documents per second
- **Memory usage**: Heap and field data cache
- **CPU utilization**: Search and indexing load
- **Disk usage**: Index size and growth rate

### Maintenance Tasks

**Regular Maintenance:**

1. **Index Optimization**

   ```bash
   curl -X POST "localhost:9200/testplanit_*/_forcemerge?max_num_segments=1"
   ```

2. **Clear Cache**

   ```bash
   curl -X POST "localhost:9200/_cache/clear"
   ```

3. **Update Mappings** (when adding new fields)

   ```bash
   curl -X PUT "localhost:9200/testplanit_repository_cases/_mapping" \
   -H "Content-Type: application/json" \
   -d @new-mapping.json
   ```

## Troubleshooting

### Common Issues

#### Search Not Working

**Symptoms:**

- No search results returned
- Search endpoint errors
- Empty response

**Solutions:**

1. Check Elasticsearch service status
2. Verify index exists and has data
3. Test Elasticsearch connectivity
4. Review application logs for errors

#### Poor Search Performance

**Symptoms:**

- Slow search responses
- High CPU usage
- Memory issues

**Solutions:**

1. Optimize query structure
2. Increase hardware resources
3. Adjust refresh intervals
4. Implement result caching

#### Index Corruption

**Symptoms:**

- Search errors
- Missing data
- Inconsistent results

**Solutions:**

1. Check cluster health
2. Reindex affected indices
3. Restore from backup
4. Review system logs

### Diagnostic Commands

```bash
# Check specific index health
curl -X GET "localhost:9200/testplanit_repository_cases/_stats?pretty"

# Analyze query performance
curl -X GET "localhost:9200/testplanit_*/_search?explain=true" \
-H "Content-Type: application/json" \
-d '{"query":{"match":{"title":"test"}}}'

# Check field mappings
curl -X GET "localhost:9200/testplanit_repository_cases/_mapping?pretty"

# Monitor search activity
curl -X GET "localhost:9200/_cat/thread_pool/search?v&h=node_name,name,active,rejected,completed"
```

## Security Configuration

### Authentication

Configure Elasticsearch security:

```yaml
elasticsearch:
  environment:
    - xpack.security.enabled=true
    - xpack.security.authc.realms.native.native1.order=0
```

Create search user:

```bash
# Create role for TestPlanIt
curl -X POST "localhost:9200/_security/role/testplanit_search" \
-u elastic:password \
-H "Content-Type: application/json" \
-d '{
  "indices": [
    {
      "names": ["testplanit_*"],
      "privileges": ["read", "write", "create_index", "delete_index"]
    }
  ]
}'

# Create user
curl -X POST "localhost:9200/_security/user/testplanit" \
-u elastic:password \
-H "Content-Type: application/json" \
-d '{
  "password": "secure_password",
  "roles": ["testplanit_search"]
}'
```

### Network Security

1. **Firewall**: Restrict Elasticsearch port access
2. **SSL/TLS**: Enable encryption for production
3. **Network Isolation**: Use private networks
4. **API Keys**: Use API keys instead of passwords

### Data Protection

1. **Field-Level Security**: Restrict sensitive fields
2. **Document-Level Security**: Filter based on user permissions
3. **Audit Logging**: Enable search audit trails
4. **Data Masking**: Mask sensitive content in logs

## Best Practices

### Development

1. **Use Aliases**: Create index aliases for flexibility
2. **Version Mappings**: Track mapping changes
3. **Test Queries**: Validate search behavior in development
4. **Monitor Resources**: Watch memory and CPU usage

### Production

1. **Backup Strategy**: Regular index backups
2. **Monitoring**: Implement comprehensive monitoring
3. **Scaling Plan**: Plan for data growth
4. **Security Hardening**: Follow Elasticsearch security guidelines
5. **Performance Testing**: Regular performance validation

### Content Strategy

1. **Consistent Indexing**: Ensure all content is indexed
2. **Rich Metadata**: Include comprehensive search fields
3. **Relevance Tuning**: Optimize search relevance scoring
4. **User Feedback**: Collect search experience feedback