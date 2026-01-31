import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import SingleFilterItemSelector from '@/components/single-filter-item-selector';
import MultiFilterItemSelector from '@/components/multi-filter-item-selector';
import { useLocalization } from '@/hooks/use-localization';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFolders } from '@/app/listview/hook/use-folders';
import { useWorldFiltersStore } from '@/app/listview/hook/use-filters';

interface AdvancedSearchPanelProps {
  onClose: () => void;
}

export function AdvancedSearchPanel({ onClose }: AdvancedSearchPanelProps) {
  const { t } = useLocalization();
  const { folders } = useFolders();
  const {
    authorFilter,
    tagFilters,
    folderFilters,
    memoTextFilter,
    photographedFilter,
    sharedFilter,
    setAuthorFilter,
    setTagFilters,
    setFolderFilters,
    setMemoTextFilter,
    setPhotographedFilter,
    setSharedFilter,
    clearFilters,
    availableAuthors,
    availableTags,
  } = useWorldFiltersStore();

  const handleClearAll = () => {
    clearFilters();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('advanced-search:title')}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="author-filter">{t('general:author')}</Label>
            <SingleFilterItemSelector
              placeholder={t('advanced-search:search-author')}
              value={authorFilter}
              candidates={availableAuthors.map((a) => ({ label: a, value: a }))}
              onValueChange={setAuthorFilter}
              allowCustomValues={false}
              id="Author"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-filter">{t('general:tags')}</Label>
            <MultiFilterItemSelector
              placeholder={t('advanced-search:search-tags')}
              values={tagFilters}
              candidates={availableTags.map((t) => ({ label: t, value: t }))}
              onValuesChange={setTagFilters}
              allowCustomValues={false}
              id="Tag"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="folder-filter">{t('general:folders')}</Label>
            <MultiFilterItemSelector
              placeholder={t('advanced-search:search-folders')}
              values={folderFilters}
              candidates={folders.map((f) => ({
                label: f.name,
                value: f.name,
              }))}
              onValuesChange={setFolderFilters}
              allowCustomValues={false}
              id="Folder"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="memo-text-filter">{t('general:memo')}</Label>
            <Input
              value={memoTextFilter}
              onChange={(e) => setMemoTextFilter(e.target.value)}
              placeholder={t('advanced-search:search-memo-text')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('world-card:photographed')}</Label>
              <Select
                value={photographedFilter === null ? 'all' : photographedFilter ? 'yes' : 'no'}
                onValueChange={(v) => setPhotographedFilter(v === 'all' ? null : v === 'yes')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('general:all')}</SelectItem>
                  <SelectItem value="yes">{t('general:yes')}</SelectItem>
                  <SelectItem value="no">{t('general:no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('world-card:shared')}</Label>
              <Select
                value={sharedFilter === null ? 'all' : sharedFilter ? 'yes' : 'no'}
                onValueChange={(v) => setSharedFilter(v === 'all' ? null : v === 'yes')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('general:all')}</SelectItem>
                  <SelectItem value="yes">{t('general:yes')}</SelectItem>
                  <SelectItem value="no">{t('general:no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClearAll}>
            {t('general:clear-all')}
          </Button>
          <Button onClick={onClose}>
            {t('advanced-search:apply-filters')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
