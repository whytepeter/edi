import { z } from 'zod';

/** Add new OS permissions here; the transport and card remain unchanged. */
export const permissionIdSchema = z.enum(['microphone', 'screen-recording']);
export type PermissionId = z.infer<typeof permissionIdSchema>;
export const permissionIds = permissionIdSchema.options;

export const permissionStatusSchema = z.enum([
  'granted',
  'not-determined',
  'denied',
  'restricted',
  'unavailable',
  'unknown',
]);
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;

export const permissionStateSchema = z
  .object({
    id: permissionIdSchema,
    status: permissionStatusSchema,
    /** True after Edi has invoked the OS request during this app session. */
    requested: z.boolean(),
  })
  .strict();
export type PermissionState = z.infer<typeof permissionStateSchema>;

export const permissionSnapshotSchema = z
  .object({
    permissions: z.array(permissionStateSchema).length(permissionIds.length),
    /** The head of the just-in-time prompt queue. */
    active: permissionIdSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set(snapshot.permissions.map(permission => permission.id));
    if (ids.size !== permissionIds.length || permissionIds.some(id => !ids.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Permission snapshot must contain every permission exactly once.',
      });
    }
  });
export type PermissionSnapshot = z.infer<typeof permissionSnapshotSchema>;

export const emptyPermissionSnapshot: PermissionSnapshot = {
  permissions: permissionIds.map(id => ({ id, status: 'unknown', requested: false })),
  active: null,
};

/**
 * Files & Folders. macOS cannot be asked whether Edi may use a protected folder without
 * prompting, so each folder shows what Edi last learned by touching it. Full Disk Access is
 * probed by reading a file only it unlocks, which never prompts.
 */
export const folderAccessStatusSchema = z.enum(['allowed', 'off', 'not-checked', 'missing']);
export type FolderAccessStatus = z.infer<typeof folderAccessStatusSchema>;

export const fileAccessSchema = z
  .object({
    folders: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            name: z.string().min(1).max(120),
            /** Shown with ~ for the home folder. */
            path: z.string().max(1024),
            kind: z.enum(['desktop', 'documents', 'downloads', 'added']),
            status: folderAccessStatusSchema,
          })
          .strict(),
      )
      .max(40),
    fullDiskAccess: z.boolean(),
  })
  .strict();
export type FileAccess = z.infer<typeof fileAccessSchema>;

export const fileAccessActionSchema = z.discriminatedUnion('type', [
  /** Touch the folder so macOS asks, then record the answer. */
  z.object({ type: z.literal('check'), id: z.string().min(1).max(80) }).strict(),
  /** Choose a folder in a macOS open panel. */
  z.object({ type: z.literal('add') }).strict(),
  z.object({ type: z.literal('remove'), id: z.string().min(1).max(80) }).strict(),
  z.object({ type: z.literal('open-settings'), pane: z.enum(['files', 'full-disk']) }).strict(),
]);
export type FileAccessAction = z.infer<typeof fileAccessActionSchema>;
