'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useQuickFolderStore } from '@/app/listview/hook/use-quick-folder';
import { commands, type RelatedWeights } from '@/lib/bindings';
import {
  analyzeColorsInBatches,
  readColorFeatures,
  type ColorFeatureMap,
} from '@/lib/color-analysis';
import { DEFAULT_RELATED_WEIGHTS } from '@/lib/related';
import { WorldCardPreview } from '@/components/world-card';
import { Platform } from '@/types/worlds';
import {
  FolderRemovalPreference,
  UpdateChannel,
  DefaultInstanceType,
} from '@/lib/bindings';
import {
  LogOut,
  Trash2,
  Upload,
  FolderOpen,
  Save,
  FolderUp,
} from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { error } from '@tauri-apps/plugin-log';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DEFAULT_STARTUP_PAGE,
  STARTUP_PAGES,
  isStartupPageId,
  type StartupPageId,
} from '@/lib/startup-page';
import { RestoreBackupDialog } from '@/app/listview/settings/components/popups/restore-backup-dialog';
import { MigrationPopup } from '@/app/listview/settings/components/popups/migration-popup';
import { DeleteDataConfirmationDialog } from '@/app/listview/settings/components/popups/delete-data-confirmation';
import { ExportPopup } from './components/popups/export';
import { useSettingsPage } from './hook';
import { useLocalization } from '@/hooks/use-localization';

export default function SettingsPage() {
  // Taken directly rather than from useSettingsPage(), which is destructured
  // further down: the preset labels below need it before that point.
  const { t } = useLocalization();

  const {
    isEnabled: isQuickFolderEnabled,
    name: quickFolderName,
    load: loadQuickFolder,
    setEnabled: setQuickFolderEnabled,
    isStatusEnabled,
    setStatusEnabled,
  } = useQuickFolderStore();

  useEffect(() => {
    loadQuickFolder();
  }, [loadQuickFolder]);

  // How much each "why is this related" signal counts. Presets rather than
  // five number boxes: the absolute values mean nothing on their own, only
  // their balance does.
  const relatedPresets: {
    id: string;
    label: string;
    description: string;
    weights: RelatedWeights;
  }[] = [
    {
      id: 'balanced',
      label: t('settings-page:related-preset-balanced'),
      description: t('settings-page:related-preset-balanced-description'),
      weights: DEFAULT_RELATED_WEIGHTS,
    },
    {
      id: 'author',
      label: t('settings-page:related-preset-author'),
      description: t('settings-page:related-preset-author-description'),
      weights: {
        tag: 0.8,
        author: 4.5,
        folder: 0.8,
        genre: 1.0,
        text: 0.6,
        color: 0.5,
      },
    },
    {
      id: 'mood',
      label: t('settings-page:related-preset-mood'),
      description: t('settings-page:related-preset-mood-description'),
      weights: {
        tag: 1.0,
        author: 0.5,
        folder: 0.8,
        genre: 2.6,
        text: 2.4,
        color: 1.6,
      },
    },
    {
      id: 'myFolders',
      label: t('settings-page:related-preset-my-folders'),
      description: t('settings-page:related-preset-my-folders-description'),
      weights: {
        tag: 1.2,
        author: 0.6,
        folder: 3.0,
        genre: 1.2,
        text: 0.8,
        color: 0.6,
      },
    },
  ];

  const [relatedWeights, setRelatedWeightsState] = useState<RelatedWeights>(
    DEFAULT_RELATED_WEIGHTS,
  );

  useEffect(() => {
    commands.getRelatedWeights().then((result) => {
      if (result.status === 'ok') setRelatedWeightsState(result.data);
    });
  }, []);

  const applyRelatedPreset = async (weights: RelatedWeights) => {
    setRelatedWeightsState(weights);
    await commands.setRelatedWeights(weights);
  };

  // Colour is kept on its own dial: it is the one signal that needs turning
  // down (or off) depending on how literal the user wants matches to be.
  const colorLevels: { id: string; label: string; value: number }[] = [
    { id: 'off', label: t('settings-page:color-level-off'), value: 0 },
    { id: 'weak', label: t('settings-page:color-level-weak'), value: 0.4 },
    { id: 'normal', label: t('settings-page:color-level-normal'), value: 0.8 },
    { id: 'strong', label: t('settings-page:color-level-strong'), value: 1.6 },
  ];

  const [startupPage, setStartupPageState] =
    useState<StartupPageId>(DEFAULT_STARTUP_PAGE);

  useEffect(() => {
    const load = async () => {
      const stored = await commands.getStartupPage();
      if (stored.status === 'ok' && isStartupPageId(stored.data)) {
        setStartupPageState(stored.data);
      }
    };
    load();
  }, []);

  const handleStartupPageChange = async (value: string) => {
    if (!isStartupPageId(value)) return;
    setStartupPageState(value);
    const result = await commands.setStartupPage(value);
    if (result.status !== 'ok') {
      error(`Error saving the startup page: ${result.error}`);
    }
  };

  const [colorAnalyzed, setColorAnalyzed] = useState(0);
  const [colorTotal, setColorTotal] = useState(0);
  const [colorProgress, setColorProgress] = useState<number | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);

  const refreshColorCounts = async () => {
    const worlds = await commands.getAllWorlds();
    if (worlds.status !== 'ok') return;

    setColorTotal(worlds.data.length);

    // Count coverage of the library specifically. The cache also holds worlds
    // picked up by related searches, so its raw size can exceed the library
    // and made the counter read "511 / 454".
    const features: ColorFeatureMap = {};
    await readColorFeatures(
      worlds.data.map((world) => world.worldId),
      features,
    );
    setColorAnalyzed(Object.keys(features).length);
  };

  useEffect(() => {
    refreshColorCounts();
  }, []);

  /** Batched so the progress bar moves and the UI keeps responding. */
  const analyzeColors = async () => {
    const worlds = await commands.getAllWorlds();
    if (worlds.status !== 'ok') return;

    const targets = worlds.data.map((world) => ({
      worldId: world.worldId,
      imageUrl: world.thumbnailUrl,
    }));

    setColorProgress(0);
    setColorError(null);

    // The features themselves are not needed here, only the side effect of
    // the backend caching them; the map is discarded.
    const outcome = await analyzeColorsInBatches(
      targets,
      {},
      {
        onBatch: ({ done, total, analyzed, failed }) => {
          // Stop only when a batch that genuinely tried to fetch things failed
          // outright - that means something systemic (blocked, offline). A
          // batch of already-cached worlds reports analyzed: 0 too, and a
          // single world whose image is gone for good must not abort the run.
          const attempted = analyzed + failed;
          if (attempted >= 5 && analyzed === 0) {
            setColorError(
              t('settings-page:color-analysis-aborted', failed.toString()),
            );
            return false;
          }
          setColorProgress(Math.round((done / total) * 100));
        },
      },
    );

    if (outcome.error) setColorError(outcome.error);

    setColorProgress(null);
    await refreshColorCounts();

    // A handful of worlds have no image any more (deleted, or made private).
    // Worth mentioning, not worth treating as a failure.
    if (!outcome.stoppedEarly && outcome.failed > 0) {
      setColorError(
        t('settings-page:color-analysis-partial', outcome.failed.toString()),
      );
    }
  };

  const setColorStrength = (value: number) =>
    applyRelatedPreset({ ...relatedWeights, color: value });

  const isSamePreset = (weights: RelatedWeights) =>
    (Object.keys(weights) as (keyof RelatedWeights)[]).every(
      (key) => Math.abs(weights[key] - relatedWeights[key]) < 0.001,
    );

  const {
    cardSize,
    language,
    folderRemovalPreference,
    updateChannel,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showMigrateDialog,
    setShowMigrateDialog,
    showRestoreDialog,
    setShowRestoreDialog,
    showExportDialog,
    setShowExportDialog,
    handleExportConfirm,
    handleBackup,
    handleRestoreConfirm,
    handleMigrationConfirm,
    handleDeleteConfirm,
    handleLogout,
    handleOpenLogs,
    handleThemeChange,
    handleLanguageChange,
    handleCardSizeChange,
    handleFolderRemovalPreferenceChange,
    handleUpdateChannelChange,
    handleDefaultInstanceTypeChange,
    defaultInstanceType,
    openHiddenFolder,
    handleNativeExport,
    visibleButtons,
    handleVisibleButtonsChange,
  } = useSettingsPage();

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t('general:settings')}</h1>
      <Tabs defaultValue="preferences" className="w-full">
        <div className="sticky top-0 z-10 bg-background pt-2 pb-2">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="preferences">
              {t('settings-page:section-preferences')}
            </TabsTrigger>
            <TabsTrigger value="data-management">
              {t('settings-page:section-data-management')}
            </TabsTrigger>
            <TabsTrigger value="others">
              {t('settings-page:section-others')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="preferences" className="space-y-4">
          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('general:theme-label')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('general:theme-description')}
              </div>
            </div>
            <Select
              value={useTheme().theme || 'system'}
              onValueChange={(value: string) => handleThemeChange(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('general:light')}</SelectItem>
                <SelectItem value="dark">{t('general:dark')}</SelectItem>
                <SelectItem value="system">{t('general:system')}</SelectItem>
              </SelectContent>
            </Select>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('general:language-label')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('general:language-description')}
              </div>
            </div>
            <Select
              value={language || 'en-US'}
              onValueChange={(value: string) => handleLanguageChange(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ja-JP">日本語</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:startup-page')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:startup-page-description')}
              </div>
            </div>
            <Select value={startupPage} onValueChange={handleStartupPageChange}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STARTUP_PAGES.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`startup-page:${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          <Card className="flex flex-col items-start justify-between space-y-3 p-4 rounded-lg border">
            <div className="flex flex-row justify-between w-full">
              <div className="flex flex-col space-y-1.5">
                <Label className="text-base font-medium">
                  {t('settings-page:world-card-size')}
                </Label>
                <div className="text-sm text-muted-foreground">
                  {t('settings-page:world-card-description')}
                </div>
              </div>
              <Select
                value={cardSize || 'Normal'}
                onValueChange={handleCardSizeChange}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Card Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Compact">
                    {t('general:compact')}
                  </SelectItem>
                  <SelectItem value="Normal">{t('general:normal')}</SelectItem>
                  <SelectItem value="Expanded">
                    {t('general:expanded')}
                  </SelectItem>
                  <SelectItem value="Original">
                    {t('general:original')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
              <div className="flex flex-col space-y-1.5">
                <Label className="text-base font-medium">
                  {t('general:instance-type')}
                </Label>
                <div className="text-sm text-muted-foreground">
                  {t('settings-page:default-instance-type-description')}
                </div>
              </div>
              <Select
                value={defaultInstanceType || 'public'}
                onValueChange={(value) =>
                  handleDefaultInstanceTypeChange(value as DefaultInstanceType)
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Instance Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    {t('world-detail:public')}
                  </SelectItem>
                  <SelectItem value="group">
                    {t('world-detail:group')}
                  </SelectItem>
                  <SelectItem value="friends+">
                    {t('world-detail:friends-plus')}
                  </SelectItem>
                  <SelectItem value="friends">
                    {t('world-detail:friends')}
                  </SelectItem>
                  <SelectItem value="invite+">
                    {t('world-detail:invite-plus')}
                  </SelectItem>
                  <SelectItem value="invite">
                    {t('world-detail:invite')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Card>

            <WorldCardPreview
              size={cardSize || 'Normal'}
              world={{
                worldId: '1',
                name: t('settings-page:preview-world'),
                thumbnailUrl: '/icons/1.png',
                authorName: t('general:author'),
                lastUpdated: '2025-02-28',
                publicationDate: null,
                visits: 1911,
                dateAdded: '2025-01-01',
                favorites: 616,
                platform: Platform.CrossPlatform,
                folders: [],
                tags: [],
                capacity: 16,
                isPhotographed: false,
                isShared: false,
                isFavorite: false,
              }}
              isVisibleButtons={visibleButtons}
              onTogglePhotographed={() => {}}
              onToggleShared={() => {}}
            />
          </Card>

          <Card className="flex flex-col space-y-3 p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5 pb-2">
              <Label className="text-base font-medium">
                {t('settings-page:visible-buttons-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:visible-buttons-description')}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="show-favorite"
                className="text-sm font-normal cursor-pointer"
              >
                {t('settings-page:show-favorite-button')}
              </Label>
              <Switch
                id="show-favorite"
                checked={visibleButtons.favorite}
                onCheckedChange={(checked: boolean) =>
                  handleVisibleButtonsChange('favorite', checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="show-photographed"
                className="text-sm font-normal cursor-pointer"
              >
                {t('settings-page:show-photographed-button')}
              </Label>
              <Switch
                id="show-photographed"
                checked={visibleButtons.photographed}
                onCheckedChange={(checked: boolean) =>
                  handleVisibleButtonsChange('photographed', checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="show-shared"
                className="text-sm font-normal cursor-pointer"
              >
                {t('settings-page:show-shared-button')}
              </Label>
              <Switch
                id="show-shared"
                checked={visibleButtons.shared}
                onCheckedChange={(checked: boolean) =>
                  handleVisibleButtonsChange('shared', checked)
                }
              />
            </div>
          </Card>

          <Card className="flex flex-col space-y-3 p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5 pb-2">
              <Label className="text-base font-medium">
                {t('settings-page:quick-folder-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t(
                  'settings-page:quick-folder-description',
                  quickFolderName || t('settings-page:quick-folder-title'),
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="quick-folder-enabled"
                className="text-sm font-normal cursor-pointer"
              >
                {t('settings-page:quick-folder-enable')}
              </Label>
              <Switch
                id="quick-folder-enabled"
                checked={isQuickFolderEnabled}
                onCheckedChange={(checked: boolean) =>
                  setQuickFolderEnabled(checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="status-folder-enabled"
                className="text-sm font-normal cursor-pointer"
              >
                {t('settings-page:status-folder-enable')}
              </Label>
              <Switch
                id="status-folder-enabled"
                checked={isStatusEnabled}
                onCheckedChange={(checked: boolean) =>
                  setStatusEnabled(checked)
                }
              />
            </div>
          </Card>

          <Card className="flex flex-col space-y-3 p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5 pb-2">
              <Label className="text-base font-medium">
                {t('settings-page:related-weights-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:related-weights-description')}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {relatedPresets.map((preset) => {
                const isActive = isSamePreset(preset.weights);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyRelatedPreset(preset.weights)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10'
                        : 'hover:bg-accent/50'
                    }`}
                  >
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">
                {t(
                  'settings-page:related-weights-summary',
                  relatedWeights.tag,
                  relatedWeights.author,
                  relatedWeights.folder,
                  relatedWeights.genre,
                  relatedWeights.text,
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyRelatedPreset(DEFAULT_RELATED_WEIGHTS)}
                disabled={isSamePreset(DEFAULT_RELATED_WEIGHTS)}
              >
                {t('settings-page:reset-defaults')}
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col space-y-3 p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5 pb-2">
              <Label className="text-base font-medium">
                {t('settings-page:color-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:color-description')}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:color-description-recommend')}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('settings-page:color-strength')}
              </span>
              {colorLevels.map((level) => (
                <Button
                  key={level.id}
                  size="sm"
                  variant={
                    Math.abs(relatedWeights.color - level.value) < 0.001
                      ? 'default'
                      : 'outline'
                  }
                  onClick={() => setColorStrength(level.value)}
                >
                  {level.label}
                </Button>
              ))}
            </div>

            {colorError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {colorError}
              </div>
            )}

            {relatedWeights.color > 0 && colorAnalyzed === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {t('settings-page:color-not-analyzed-warning')}
              </div>
            )}

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {t(
                  'settings-page:color-analyzed-count',
                  colorAnalyzed.toString(),
                  colorTotal.toString(),
                )}
                {colorProgress !== null &&
                  t(
                    'settings-page:color-analyzing-percent',
                    colorProgress.toString(),
                  )}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={analyzeColors}
                disabled={colorProgress !== null}
              >
                {colorProgress !== null
                  ? t('settings-page:color-analyzing')
                  : t('settings-page:color-analyze')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('settings-page:color-analyze-note')}
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="data-management" className="space-y-4">
          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:hidden-folder')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:hidden-folder-description')}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={openHiddenFolder}
              className="gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="text-sm">{t('general:open-folder')}</span>
            </Button>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:backup-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:backup-description')}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={handleBackup}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                <span className="text-sm">
                  {t('settings-page:create-backup')}
                </span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowRestoreDialog(true)}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                <span className="text-sm">
                  {t('settings-page:restore-backup')}
                </span>
              </Button>
            </div>
          </Card>
          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:export-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:export-description')}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(true)}
              className="gap-2"
            >
              <FolderUp className="h-4 w-4" />
              <span className="text-sm">{t('settings-page:export-data')}</span>
            </Button>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:native-export-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:native-export-description')}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleNativeExport}
              className="gap-2"
            >
              <FolderUp className="h-4 w-4" />
              <span className="text-sm">{t('settings-page:export-data')}</span>
            </Button>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:data-migration-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:data-migration-description')}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowMigrateDialog(true)}
              className="gap-2"
            >
              <span className="text-sm">{t('settings-page:migrate-data')}</span>
            </Button>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border border-destructive bg-destructive/5">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:data-deletion-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:data-deletion-description')}
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              <span className="text-sm">
                {t('settings-page:delete-all-data')}
              </span>
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="others" className="space-y-4">
          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:folder-removal-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:folder-removal-description')}
              </div>
            </div>
            <Select
              value={folderRemovalPreference || 'Both'}
              onValueChange={(value: string) =>
                handleFolderRemovalPreferenceChange(
                  value as FolderRemovalPreference,
                )
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Folder Removal Preference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">
                  {t('settings-page:folder-removal-ask')}
                </SelectItem>
                <SelectItem value="neverRemove">
                  {t('settings-page:folder-removal-keep')}
                </SelectItem>
                <SelectItem value="alwaysRemove">
                  {t('settings-page:folder-removal-remove')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:logs-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:logs-description')}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleOpenLogs}
              className="gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="text-sm">{t('general:open-folder')}</span>
            </Button>
          </Card>

          <Card className="flex flex-row items-center justify-between p-4 rounded-lg border">
            <div className="flex flex-col space-y-1.5">
              <Label className="text-base font-medium">
                {t('settings-page:logout-title')}
              </Label>
              <div className="text-sm text-muted-foreground">
                {t('settings-page:logout-description')}
              </div>
            </div>
            <Button variant="outline" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="text-sm">{t('settings-page:logout')}</span>
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      <RestoreBackupDialog
        open={showRestoreDialog}
        onOpenChange={setShowRestoreDialog}
        onConfirm={handleRestoreConfirm}
      />
      <ExportPopup
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        onConfirm={handleExportConfirm}
      />
      <MigrationPopup
        open={showMigrateDialog}
        onOpenChange={setShowMigrateDialog}
        onConfirm={handleMigrationConfirm}
      />
      <DeleteDataConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
