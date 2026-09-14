import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { artifactParams, bubbleParams, menuParams, pointerParams, surface } from './app/surface';
import { ArtifactWindow } from './components/artifacts/Artifact';
import { WorkspaceCard } from './app/WorkspaceCard';
import { PetSurface } from './features/pet/PetSurface';
import { CharacterMenu } from './features/pet/CharacterMenu';
import { StatusBubble } from './features/pet/StatusBubble';
import { startVoiceClient } from './features/voice/VoiceClient';
import { PointerSurface } from './features/pointer/PointerSurface';

document.documentElement.dataset.surface = surface;
// Menus and bubbles are native glass windows; their CSS stays clear so the blur shows through.
const glassSurfaces = ['character-menu', 'voice-status', 'artifact', 'workspace'];
if (glassSurfaces.includes(surface)) document.documentElement.dataset.nativeGlass = '';

// The pet window owns the microphone and speaker for voice turns; main drives them.
// Edi's mouth follows the loudness of its own speech through one CSS variable.
if (surface === 'pet' && window.edi)
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
  });

const view = {
  workspace: <WorkspaceCard />,
  artifact: <ArtifactWindow {...artifactParams} />,
  pet: <PetSurface />,
  'character-menu': <CharacterMenu {...menuParams} />,
  'voice-status': <StatusBubble {...bubbleParams} />,
  pointer: <PointerSurface {...pointerParams} />,
}[surface];

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>);
