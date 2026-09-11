import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { bubbleParams, surface } from './app/surface';
import { WorkspaceCard } from './app/WorkspaceCard';
import { PetSurface } from './features/pet/PetSurface';
import { CharacterMenu } from './features/pet/CharacterMenu';
import { StatusBubble } from './features/pet/StatusBubble';

document.documentElement.dataset.surface = surface;

const view = {
  workspace: <WorkspaceCard />,
  pet: <PetSurface />,
  'character-menu': <CharacterMenu />,
  'voice-status': <StatusBubble {...bubbleParams} />,
}[surface];

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>);
