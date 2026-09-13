import { inkFor } from '../../lib/bridge';
import { useSettings } from '../../hooks/useSettings';
import { DesktopPet } from './DesktopPet';
import './pet.css';

/** The always-on-top character window. */
export function PetSurface() {
  const { settings } = useSettings();
  const [expression, setExpression] = useState<CharacterExpression>('idle');
  useEffect(() => window.edi?.onCharacterExpression(setExpression), []);
  return <DesktopPet skin={settings.skin} color={inkFor(settings.skin)} expression={expression} />;
}
import { useEffect, useState } from 'react';
import type { CharacterExpression } from '@edi/contracts';
