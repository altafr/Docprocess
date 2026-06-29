

import { useState } from 'react';
import { MessageSquare, Users, Languages, FileText, Settings, X, FolderSearch, ChartBar as BarChart2, Network, ScrollText, Tags, ShieldCheck, BookOpen, Search, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BRAND_RED } from '@/lib/constants';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isOpen: boolean;
  onClose?: () => void;
}

const navItems = [
  { id: 'procedure',         label: 'Procedure Q&A',        icon: MessageSquare },
  { id: 'asksme',            label: 'AskSME',               icon: Users },
  { id: 'translation',       label: 'Translation Service',  icon: Languages },
  { id: 'ocr',               label: 'Data Extraction (OCR)', icon: FileText },
  { id: 'docprocessor',      label: 'Document Processor',   icon: FolderSearch },
  { id: 'usagelogs',         label: 'Usage Logs',           icon: BarChart2 },
  { id: 'boardresolutions',  label: 'Board Resolutions',    icon: ScrollText },
  { id: 'companyMandates',   label: 'Company Mandates',     icon: ShieldCheck },
  { id: 'companyanalysis',   label: 'Company Analysis',     icon: GitBranch },
  { id: 'categories',        label: 'Document Categories',  icon: Tags },
  { id: 'pipeline',          label: 'Processing Pipeline',  icon: Network },
  { id: 'promptlibrary',     label: 'Prompt Library',       icon: BookOpen },
  { id: 'knowledgesearch',   label: 'Knowledge Search',     icon: Search },
];

export function Sidebar({ activeTab, onTabChange, isOpen, onClose }: SidebarProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleItemClick = (itemId: string) => {
    onTabChange(itemId);
    if (onClose && window.innerWidth < 1024) onClose();
  };

  const expanded = isHovered || isOpen;

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          'fixed left-0 top-[36px] bottom-0 bg-white border-r border-gray-200 transition-all duration-300 z-40 overflow-hidden',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0 w-64' : '-translate-x-full w-20',
          'lg:w-20',
          isHovered && 'lg:w-64',
        )}
      >
        {/* Flex column so close-button row is fixed height, nav scrolls */}
        <div className="flex flex-col h-full">
          {/* Mobile close button */}
          <div className="flex items-center justify-end px-4 pt-3 pb-1 shrink-0 lg:hidden">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable nav — overflow-y-auto is scoped inside the aside so x-clipping still works */}
          <nav className="flex flex-col gap-1 px-3 py-2 overflow-y-auto flex-1 pb-6">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item.id)}
                  title={item.label}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left whitespace-nowrap w-full',
                    isActive
                      ? 'bg-red-50 text-[#DB0011]'
                      : 'text-gray-700 hover:bg-gray-50',
                  )}
                >
                  <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-[#DB0011]')} />
                  <span className={cn(
                    'font-medium text-sm transition-all duration-300 overflow-hidden',
                    expanded ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0',
                  )}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}

