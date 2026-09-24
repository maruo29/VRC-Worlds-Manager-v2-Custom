'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Palette } from 'lucide-react';
import { useLocalization } from '@/hooks/use-localization';
import { COLOR_PALETTE_IDS, type ColorPaletteId } from '@/lib/color-palette';

interface ColorPaletteSelectProps {
  value: ColorPaletteId[];
  onChange: (value: ColorPaletteId[]) => void;
}

/**
 * Picks colour families to prioritise, combined with AND.
 *
 * Deliberately empty by default: with nothing chosen, colour follows whatever
 * the surrounding page infers, and this only takes over when the user says so.
 */
export function ColorPaletteSelect({
  value,
  onChange,
}: ColorPaletteSelectProps) {
  const { t } = useLocalization();

  const label =
    value.length === 0
      ? t('color-palette:none')
      : value.map((id) => t(`color-palette:${id}`)).join(' + ');

  const toggle = (id: ColorPaletteId, checked: boolean) => {
    // Kept in the declared order rather than click order, so the label reads
    // the same way every time.
    onChange(
      checked
        ? COLOR_PALETTE_IDS.filter(
            (candidate) => candidate === id || value.includes(candidate),
          )
        : value.filter((candidate) => candidate !== id),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={value.length > 0 ? 'default' : 'outline'}
          className="h-9 flex items-center gap-2 max-w-[240px]"
          title={t('color-palette:hint')}
        >
          <Palette className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
          {t('color-palette:hint')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {COLOR_PALETTE_IDS.map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={value.includes(id)}
            onCheckedChange={(checked) => toggle(id, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="flex flex-col">
              <span>{t(`color-palette:${id}`)}</span>
              {id === 'green' && (
                <span className="text-xs text-muted-foreground">
                  {t('color-palette:green-note')}
                </span>
              )}
            </span>
          </DropdownMenuCheckboxItem>
        ))}

        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>
              {t('color-palette:clear')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
