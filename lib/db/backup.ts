import { exec } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { log } from '../log'
import { getEnvVar } from '../env-security'

const BACKUP_DIR = join(process.cwd(), 'backups')

interface BackupInfo {
  filename: string
  size: number
  created: Date
}

export async function createBackup(): Promise<string> {
  try {
    // Ensure backup directory exists
    await fs.mkdir(BACKUP_DIR, { recursive: true })
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `backup-${timestamp}.sql`
    const filepath = join(BACKUP_DIR, filename)
    
    const databaseUrl = getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL')
    if (!databaseUrl) {
      throw new Error('Database URL not configured')
    }
    
    // Extract database name from URL for pg_dump
    const dbName = new URL(databaseUrl).pathname.slice(1)
    
    return new Promise((resolve, reject) => {
      const command = `pg_dump "${databaseUrl}" > "${filepath}"`
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          log('Backup creation failed', { error: error.message })
          reject(error)
          return
        }
        
        if (stderr) {
          log('Backup warning', { warning: stderr })
        }
        
        log('Backup created successfully', { filename, filepath })
        resolve(filename)
      })
    })
  } catch (error) {
    log('Backup creation error', { error: error instanceof Error ? error.message : 'Unknown error' })
    throw error
  }
}

export async function listBackups(): Promise<BackupInfo[]> {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true })
    
    const files = await fs.readdir(BACKUP_DIR)
    const backups: BackupInfo[] = []
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const filepath = join(BACKUP_DIR, file)
        const stats = await fs.stat(filepath)
        
        backups.push({
          filename: file,
          size: stats.size,
          created: stats.birthtime
        })
      }
    }
    
    return backups.sort((a, b) => b.created.getTime() - a.created.getTime())
  } catch (error) {
    log('Failed to list backups', { error: error instanceof Error ? error.message : 'Unknown error' })
    throw error
  }
}

export async function scheduleBackup(): Promise<void> {
  // In a real implementation, this would set up a cron job or scheduled task
  log('Backup scheduling not implemented', { 
    note: 'Use cron or a task scheduler to run: pnpm db:backup'
  })
  
  // For demo purposes, just create a backup now
  await createBackup()
}

/**
 * Restore database from backup file
 */
export async function restoreBackup(filename: string): Promise<void> {
  try {
    const filepath = join(BACKUP_DIR, filename);

    // Check if backup file exists
    await fs.access(filepath);

    const databaseUrl = getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('Database URL not configured');
    }

    log('Starting database restore', { filename, filepath });

    // Extract database connection details from URL
    const dbUrl = new URL(databaseUrl);
    const dbName = dbUrl.pathname.slice(1);
    const host = dbUrl.hostname;
    const port = dbUrl.port || '5432';
    const user = dbUrl.username;
    const password = dbUrl.password;

    return new Promise((resolve, reject) => {
      // Use psql to restore the database
      const command = `PGPASSWORD="${password}" psql -h ${host} -p ${port} -U ${user} -d ${dbName} < "${filepath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          log('Restore failed', { error: error.message, filename });
          reject(error);
          return;
        }

        if (stderr && !stderr.includes('NOTICE')) {
          log('Restore warning', { warning: stderr, filename });
        }

        log('Database restore completed successfully', { filename, filepath });
        resolve();
      });
    });
  } catch (error) {
    log('Backup restore error', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

/**
 * Main function for CLI usage
 */
async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'create':
        const filename = await createBackup();
        console.log(`Backup created: ${filename}`);
        break;

      case 'list':
        const backups = await listBackups();
        console.log('Available backups:');
        backups.forEach(backup => {
          console.log(`  ${backup.filename} - ${backup.size} bytes - ${backup.created.toISOString()}`);
        });
        break;

      case 'restore':
        const restoreFile = process.argv[3];
        if (!restoreFile) {
          console.error('Usage: npm run db:backup restore <filename>');
          process.exit(1);
        }
        await restoreBackup(restoreFile);
        console.log(`Backup restored: ${restoreFile}`);
        break;

      default:
        console.log('Usage:');
        console.log('  npm run db:backup create  - Create a new backup');
        console.log('  npm run db:backup list    - List available backups');
        console.log('  npm run db:backup restore <filename> - Restore from backup');
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
