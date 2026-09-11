import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './CompactApp';
import { VoiceStatusBubble } from './VoiceStatusBubble';
import { CharacterMenu } from './CharacterMenu';
import './compact.css';
import './pet.css';
const voiceStatus = new URLSearchParams(location.search).get('surface') === 'voice-status';
const characterMenu = new URLSearchParams(location.search).get('surface') === 'character-menu';
if (voiceStatus) document.body.classList.add('voice-status-surface');
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {voiceStatus ? <VoiceStatusBubble state="unavailable" /> : characterMenu ? <CharacterMenu /> : <App />}
</React.StrictMode>);
