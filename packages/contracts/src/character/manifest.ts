import { z } from 'zod';
import { assistantNameSchema } from '../assistant-name';
import { characterGeometrySchema } from '../skin-geometry';

/**
 * `character.json`: who a character is and how Edi places it. The art lives next to it in
 * `art.svg`. Packages hold data only, never code, so installing one cannot run anything.
 */
export const characterIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    'Use lowercase letters, digits, dots and hyphens, like com.example.luna',
  );
export type CharacterId = z.infer<typeof characterIdSchema>;

/** Ids of the characters that ship with Edi; a package cannot take them. */
export const builtInCharacterIds = ['edi', 'mochi'] as const;
export const defaultCharacterId = 'edi';

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color like #3d2419')
  .transform(value => value.toLowerCase());

export const characterManifestSchema = z
  .object({
    /** The package format. Edi refuses formats it does not know. */
    format: z.literal(1),
    id: characterIdSchema,
    /** The character's own name, used until the person names their companion. */
    name: assistantNameSchema,
    version: z
      .string()
      .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, 'Use a version like 1.0.0')
      .default('1.0.0'),
    description: z.string().trim().max(120).default(''),
    author: z
      .object({
        name: z.string().trim().min(1).max(60),
        url: z
          .string()
          .url()
          .max(200)
          .refine(value => value.startsWith('https://'), 'Use an https link')
          .optional(),
      })
      .strict(),
    /** An SPDX identifier (CC-BY-4.0, MIT…) or "All rights reserved". */
    license: z.string().trim().min(1).max(60),
    colors: z
      .object({
        /** The card, bubbles and pointer take on this color. */
        accent: color,
        /** Line color for the gesture hands and pointer. */
        outline: color,
        /** Fill for the gesture hands and pointer. */
        skin: color,
      })
      .strict(),
    geometry: characterGeometrySchema,
    motion: z
      .object({
        /** Scales every movement: 0.5 is calm, 1.5 is lively. */
        intensity: z.number().min(0.5).max(1.5).default(1),
        /** Whether Edi blinks the eyes. Turn off for characters without eyelids. */
        blink: z.boolean().default(true),
      })
      .strict()
      .default({ intensity: 1, blink: true }),
    /** Edi's floating hearts, question marks and z's around the head, unless the art has its own. */
    effects: z.boolean().default(true),
  })
  .strict();
export type CharacterManifest = z.infer<typeof characterManifestSchema>;

/** A validated character ready to render: its manifest and sanitized, id-scoped art. */
export interface CharacterDescriptor {
  manifest: CharacterManifest;
  /** Inner SVG markup. `{{scope}}` must be replaced with a unique prefix per rendered copy. */
  art: string;
  /** Variants each part of the art offers, e.g. { eyes: ['default', 'happy'] }. */
  variants: Record<string, string[]>;
  builtIn: boolean;
}

export const characterDescriptorSchema = z
  .object({
    manifest: characterManifestSchema,
    art: z.string().max(600_000),
    variants: z.record(z.string(), z.array(z.string().max(24)).max(40)),
    builtIn: z.boolean(),
  })
  .strict();
export const characterListSchema = z.array(characterDescriptorSchema).max(64);
