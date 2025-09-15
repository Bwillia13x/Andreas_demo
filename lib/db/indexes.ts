/**
 * Database Indexes and Optimization
 * Defines and manages database indexes for optimal query performance
 */

import { sql } from 'drizzle-orm';
import { db } from './index';
import { log } from '../log';

export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
  where?: string;
  description: string;
}

/**
 * Core indexes for optimal query performance
 * Based on common query patterns in the application
 */
export const CORE_INDEXES: IndexDefinition[] = [
  // Appointments table - most critical for scheduling
  {
    name: 'idx_appointments_customer_id',
    table: 'appointments',
    columns: ['customer_id'],
    description: 'Fast lookup of appointments by customer'
  },
  {
    name: 'idx_appointments_staff_id',
    table: 'appointments',
    columns: ['staff_id'],
    description: 'Fast lookup of appointments by staff member'
  },
  {
    name: 'idx_appointments_scheduled_start',
    table: 'appointments',
    columns: ['scheduled_start'],
    description: 'Date range queries for calendar views'
  },
  {
    name: 'idx_appointments_status',
    table: 'appointments',
    columns: ['status'],
    description: 'Filter appointments by status'
  },
  {
    name: 'idx_appointments_customer_date',
    table: 'appointments',
    columns: ['customer_id', 'scheduled_start'],
    description: 'Customer appointment history queries'
  },

  // Services table
  {
    name: 'idx_services_name',
    table: 'services',
    columns: ['name'],
    description: 'Service name lookups'
  },
  {
    name: 'idx_services_category',
    table: 'services',
    columns: ['category'],
    description: 'Filter services by category'
  },

  // Staff table
  {
    name: 'idx_staff_email',
    table: 'staff',
    columns: ['email'],
    unique: true,
    description: 'Staff email uniqueness and lookups'
  },
  {
    name: 'idx_staff_role',
    table: 'staff',
    columns: ['role'],
    description: 'Filter staff by role'
  },

  // Customers table
  {
    name: 'idx_customers_email',
    table: 'customers',
    columns: ['email'],
    unique: true,
    description: 'Customer email uniqueness and lookups'
  },
  {
    name: 'idx_customers_phone',
    table: 'customers',
    columns: ['phone'],
    description: 'Customer phone lookups'
  },
  {
    name: 'idx_customers_created_at',
    table: 'customers',
    columns: ['created_at'],
    description: 'Customer registration date queries'
  },

  // Sales/POS tables
  {
    name: 'idx_sales_created_at',
    table: 'sales',
    columns: ['created_at'],
    description: 'Sales date range queries'
  },
  {
    name: 'idx_sales_customer_id',
    table: 'sales',
    columns: ['customer_id'],
    description: 'Customer purchase history'
  },

  // Analytics table - critical for reporting
  {
    name: 'idx_analytics_date',
    table: 'analytics',
    columns: ['date'],
    unique: true,
    description: 'Daily analytics lookups'
  },

  // Loyalty entries
  {
    name: 'idx_loyalty_entries_customer_id',
    table: 'loyalty_entries',
    columns: ['customer_id'],
    description: 'Customer loyalty history'
  },
  {
    name: 'idx_loyalty_entries_created_at',
    table: 'loyalty_entries',
    columns: ['created_at'],
    description: 'Loyalty entry date queries'
  },

  // Marketing campaigns
  {
    name: 'idx_campaigns_status',
    table: 'campaigns',
    columns: ['status'],
    description: 'Filter campaigns by status'
  },
  {
    name: 'idx_campaigns_created_at',
    table: 'campaigns',
    columns: ['created_at'],
    description: 'Campaign creation date queries'
  },

  // Inventory
  {
    name: 'idx_inventory_name',
    table: 'inventory',
    columns: ['name'],
    description: 'Inventory item name lookups'
  },
  {
    name: 'idx_inventory_sku',
    table: 'inventory',
    columns: ['sku'],
    unique: true,
    description: 'Inventory SKU lookups and uniqueness'
  }
];

/**
 * Performance optimization indexes for complex queries
 */
export const PERFORMANCE_INDEXES: IndexDefinition[] = [
  // Composite indexes for complex queries
  {
    name: 'idx_appointments_date_status',
    table: 'appointments',
    columns: ['scheduled_start', 'status'],
    description: 'Calendar views with status filtering'
  },
  {
    name: 'idx_appointments_staff_date',
    table: 'appointments',
    columns: ['staff_id', 'scheduled_start'],
    description: 'Staff schedule queries'
  },
  {
    name: 'idx_sales_date_amount',
    table: 'sales',
    columns: ['created_at', 'total'],
    description: 'Sales reporting with amount sorting'
  }
];

/**
 * Create a single index
 */
export async function createIndex(indexDef: IndexDefinition): Promise<void> {
  try {
    let sqlQuery: string;

    if (indexDef.unique) {
      sqlQuery = `CREATE UNIQUE INDEX IF NOT EXISTS ${indexDef.name} ON ${indexDef.table} (${indexDef.columns.join(', ')})`;
    } else {
      sqlQuery = `CREATE INDEX IF NOT EXISTS ${indexDef.name} ON ${indexDef.table} (${indexDef.columns.join(', ')})`;
    }

    if (indexDef.where) {
      sqlQuery += ` WHERE ${indexDef.where}`;
    }

    log(`Creating index: ${indexDef.name}`, {
      table: indexDef.table,
      columns: indexDef.columns,
      description: indexDef.description
    });

    await db.execute(sql`${sqlQuery}`);

    log(`Successfully created index: ${indexDef.name}`);
  } catch (error) {
    log(`Failed to create index ${indexDef.name}`, {
      error: error instanceof Error ? error.message : String(error),
      table: indexDef.table,
      columns: indexDef.columns
    });
    throw error;
  }
}

/**
 * Drop an index if it exists
 */
export async function dropIndex(indexName: string): Promise<void> {
  try {
    log(`Dropping index: ${indexName}`);
    await db.execute(sql`DROP INDEX IF EXISTS ${sql.identifier(indexName)}`);
    log(`Successfully dropped index: ${indexName}`);
  } catch (error) {
    log(`Failed to drop index ${indexName}`, {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Create all core indexes
 */
export async function createCoreIndexes(): Promise<void> {
  log('Starting core index creation', { indexCount: CORE_INDEXES.length });

  for (const indexDef of CORE_INDEXES) {
    try {
      await createIndex(indexDef);
    } catch (error) {
      log(`Failed to create core index ${indexDef.name}, continuing...`, {
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue with other indexes even if one fails
    }
  }

  log('Core index creation completed');
}

/**
 * Create all performance optimization indexes
 */
export async function createPerformanceIndexes(): Promise<void> {
  log('Starting performance index creation', { indexCount: PERFORMANCE_INDEXES.length });

  for (const indexDef of PERFORMANCE_INDEXES) {
    try {
      await createIndex(indexDef);
    } catch (error) {
      log(`Failed to create performance index ${indexDef.name}, continuing...`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  log('Performance index creation completed');
}

/**
 * Create all indexes (core + performance)
 */
export async function createAllIndexes(): Promise<void> {
  await createCoreIndexes();
  await createPerformanceIndexes();
}

/**
 * Get list of existing indexes
 */
export async function getExistingIndexes(): Promise<Array<{ name: string; table: string; definition: string }>> {
  try {
    const result = await db.execute(sql`
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);

    return result.rows.map(row => ({
      name: String(row.indexname),
      table: String(row.tablename),
      definition: String(row.indexdef)
    }));
  } catch (error) {
    log('Failed to get existing indexes', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Analyze table statistics for query optimization
 */
export async function analyzeTables(): Promise<void> {
  try {
    log('Starting table analysis for query optimization');

    // Get all user tables
    const tablesResult = await db.execute(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    for (const row of tablesResult.rows) {
      const tableName = String(row.tablename);
      log(`Analyzing table: ${tableName}`);
      await db.execute(sql`ANALYZE ${sql.identifier(tableName)}`);
    }

    log('Table analysis completed');
  } catch (error) {
    log('Failed to analyze tables', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Generate index recommendations based on query patterns
 * This is a simplified version - in production you'd use tools like pg_stat_statements
 */
export async function generateIndexRecommendations(): Promise<string[]> {
  const recommendations: string[] = [];

  try {
    // Check for missing indexes on foreign keys
    const fkResult = await db.execute(sql`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);

    for (const fk of fkResult.rows) {
      // Check if foreign key column has an index
      const indexResult = await db.execute(sql`
        SELECT 1
        FROM pg_indexes
        WHERE tablename = ${fk.table_name}
          AND indexdef LIKE ${'%' + fk.column_name + '%'}
      `);

      if (indexResult.rows.length === 0) {
        recommendations.push(
          `Consider adding index on ${fk.table_name}.${fk.column_name} (foreign key to ${fk.referenced_table}.${fk.referenced_column})`
        );
      }
    }

    return recommendations;
  } catch (error) {
    log('Failed to generate index recommendations', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Main CLI function
 */
async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'create-core':
        await createCoreIndexes();
        break;

      case 'create-performance':
        await createPerformanceIndexes();
        break;

      case 'create-all':
        await createAllIndexes();
        break;

      case 'list':
        const indexes = await getExistingIndexes();
        console.log('Existing indexes:');
        indexes.forEach(idx => {
          console.log(`  ${idx.name} on ${idx.table}`);
        });
        break;

      case 'analyze':
        await analyzeTables();
        break;

      case 'recommend':
        const recommendations = await generateIndexRecommendations();
        console.log('Index recommendations:');
        recommendations.forEach(rec => console.log(`  ${rec}`));
        break;

      default:
        console.log('Usage:');
        console.log('  npm run db:indexes create-core       - Create core indexes');
        console.log('  npm run db:indexes create-performance - Create performance indexes');
        console.log('  npm run db:indexes create-all         - Create all indexes');
        console.log('  npm run db:indexes list               - List existing indexes');
        console.log('  npm run db:indexes analyze            - Analyze tables for optimization');
        console.log('  npm run db:indexes recommend          - Generate index recommendations');
        break;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
