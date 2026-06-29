

import { useState } from 'react';
import { MessageSquare, Users, Languages, FileText, Settings, X, FolderSearch, ChartBar as BarChart2, Network, ScrollText, Tags, ShieldCheck, BookOpen, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BRAND_RED } from '@/lib/constants';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isOpen: boolean;
  onClose?: () => void;
}

const navItems = [
  { id: 'procedure',   label: 'Procedure Q&A',        icon: MessageSquare },
  { id: 'asksme',      label: 'AskSME',               icon: Users },
  { id: 'translation', label: 'Translation Service',  icon: Languages },
  { id: 'ocr',         label: 'Data Extraction (OCR)', icon: FileText },
  { id: 'docprocessor',label: 'Document Processor',   icon: FolderSearch },
  { id: 'usagelogs',        label: 'Usage Logs',           icon: BarChart2 },
  { id: 'boardresolutions', label: 'Board Resolutions',    icon: ScrollText },
  { id: 'companyMandates',  label: 'Company Mandates',     icon: ShieldCheck },
  { id: 'categories',       label: 'Document Categories',  icon: Tags },
  { id: 'pipeline',         label: 'Processing Pipeline',  icon: Network },
  { id: 'promptlibrary',    label: 'Prompt Library',        icon: BookOpen },
  { id: 'knowledgesearch',  label: 'Knowledge Search',      icon: Search },
];

export function Sidebar({ activeTab, onTabChange, isOpen, onClose }: SidebarProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleItemClick = (itemId: string) => {
    onTabChange(itemId);
    if (onClose && window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
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
          'fixed left-0 top-[73px] bottom-0 bg-white border-r border-gray-200 transition-all duration-300 z-40 overflow-hidden',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0 w-64' : '-translate-x-full w-20',
          'lg:w-20',
          isHovered && 'lg:w-64'
        )}
      >
        <div className="relative h-full">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>

          <nav className="flex flex-col gap-2 p-4 mt-12 lg:mt-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left whitespace-nowrap',
                    isActive
                      ? 'bg-red-50 text-[#DB0011]'
                      : 'text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-[#DB0011]')} />
                  <span className={cn(
                    'font-medium text-sm transition-all duration-300',
                    isHovered || isOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 lg:opacity-0 lg:w-0'
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
