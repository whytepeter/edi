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
