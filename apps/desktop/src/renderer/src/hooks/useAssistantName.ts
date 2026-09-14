import { createContext, useContext } from 'react';

/**
 * What the person calls their companion: their chosen name, or the character's own. Windows
 * that load settings provide it; everything else reads it here instead of writing "Edi".
 */
export const AssistantNameContext = createContext('Edi');

export const useAssistantName = () => useContext(AssistantNameContext);
