import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { bubbleParams, surface } from './app/surface';
import { WorkspaceCard } from './app/WorkspaceCard';
import { PetSurface } from './features/pet/PetSurface';
import { CharacterMenu } from './features/pet/CharacterMenu';
import { StatusBubble } from './features/pet/StatusBubble';
import { startVoiceClient } from './features/voice/VoiceClient';

document.documentElement.dataset.surface = surface;

// The pet window owns the microphone and speaker for voice turns; main drives them.
if (surface === 'pet' && window.edi) startVoiceClient(window.edi);

const view = {
  workspace: <WorkspaceCard />,
  pet: <PetSurface />,
  'character-menu': <CharacterMenu />,
  'voice-status': <StatusBubble {...bubbleParams} />,
}[surface];

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>);
