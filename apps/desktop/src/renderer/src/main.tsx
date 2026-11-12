import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import {
  annotateParams,
  artifactParams,
  bubbleParams,
  exportParams,
  menuParams,
  pointerParams,
  surface,
  type Surface,
} from './app/surface';

document.documentElement.dataset.surface = surface;
// Menus and bubbles are native glass windows; their CSS stays clear so the blur shows through.
const glassSurfaces = ['character-menu', 'voice-status', 'artifact', 'workspace'];
if (glassSurfaces.includes(surface)) document.documentElement.dataset.nativeGlass = '';

/**
 * Each window loads only its own view. Every surface shares one page, and importing them all
 * made the pet, bubble, menu, pointer and ink overlays load Settings, the Library and the rest.
 */
const views: Record<Surface, () => Promise<ReactNode>> = {
  workspace: async () => {
    const { WorkspaceCard } = await import('./app/WorkspaceCard');
    return <WorkspaceCard />;
  },
  artifact: async () => {
    const { ArtifactWindow } = await import('./components/artifacts/Artifact');
    return <ArtifactWindow {...artifactParams} />;
  },
  export: async () => {
    const { ExportPage } = await import('./components/artifacts/ExportPage');
    return <ExportPage {...exportParams} />;
  },
  pet: async () => {
    const [{ PetSurface }, { startVoiceClient }, { cueStore }] = await Promise.all([
      import('./features/pet/PetSurface'),
      import('./features/voice/VoiceClient'),
      import('./features/pet/cue-store'),
    ]);
    // The pet window owns the microphone and speaker for voice turns; main drives them.
    // Edi's mouth follows the loudness of its own speech through one CSS variable.
    if (window.edi)
      startVoiceClient(window.edi, {
        onSpeechLevel: level => {
          const root = document.documentElement;
          if (level === null) {
            delete root.dataset.lipSync;
            root.style.removeProperty('--edi-mouth');
          } else {
            root.dataset.lipSync = '';
            root.style.setProperty('--edi-mouth', String(level));
          }
        },
        // A laugh, sigh or gasp is audible now: the character performs it for about as long.
        onCue: cue => cueStore.play(cue),
      });
    return <PetSurface />;
  },
  'character-menu': async () => {
    const { CharacterMenu } = await import('./features/pet/CharacterMenu');
    return <CharacterMenu {...menuParams} />;
  },
  'voice-status': async () => {
    const { StatusBubble } = await import('./features/pet/StatusBubble');
    return <StatusBubble {...bubbleParams} />;
  },
  pointer: async () => {
    const { PointerSurface } = await import('./features/pointer/PointerSurface');
    return <PointerSurface {...pointerParams} />;
  },
  annotate: async () => {
    const { AnnotateSurface } = await import('./features/annotate/AnnotateSurface');
    return <AnnotateSurface {...annotateParams} />;
  },
};

void views[surface]().then(view =>
  createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>),
);
