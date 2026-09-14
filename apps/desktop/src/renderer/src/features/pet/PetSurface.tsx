import { inkFor } from '../../lib/bridge';
import { useSettings } from '../../hooks/useSettings';
import { AssistantNameContext } from '../../hooks/useAssistantName';
import { DesktopPet } from './DesktopPet';
import './pet.css';

/** The always-on-top character window. */
export function PetSurface() {
  const { settings } = useSettings();
  const [expression, setExpression] = useState<CharacterExpression>('idle');
  useEffect(() => window.edi?.onCharacterExpression(setExpression), []);
  return (
    <AssistantNameContext.Provider value={assistantName(settings)}>
      <DesktopPet skin={settings.skin} color={inkFor(settings.skin)} expression={expression} />
    </AssistantNameContext.Provider>
  );
}
import { useEffect, useState } from 'react';
import { assistantName, type CharacterExpression } from '@edi/contracts';
