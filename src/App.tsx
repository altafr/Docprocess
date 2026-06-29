import { useState } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { ProcedureQA } from '@/components/screens/ProcedureQA';
import { AskSME } from '@/components/screens/AskSME';
import { TranslationService } from '@/components/screens/TranslationService';
import { DataExtraction } from '@/components/screens/DataExtraction';
import { Settings } from '@/components/screens/Settings';
import { DocumentProcessor } from '@/components/screens/DocumentProcessor';
import { UsageLogs } from '@/components/screens/UsageLogs';
import { ProcessingPipeline } from '@/components/screens/ProcessingPipeline';
import { BoardResolutions } from '@/components/screens/BoardResolutions';
import { CategoryManager } from '@/components/screens/CategoryManager';
import { CompanyMandates } from '@/components/screens/CompanyMandates';
import { PromptLibrary } from '@/components/screens/PromptLibrary';
import { KnowledgeSearch } from '@/components/screens/KnowledgeSearch';
import { Toaster } from '@/components/ui/sonner';

function App() {
  const [activeTab, setActiveTab] = useState('procedure');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderContent = () => {
    switch (activeTab) {
      case 'procedure':
        return <ProcedureQA />;
      case 'asksme':
        return <AskSME />;
      case 'translation':
        return <TranslationService />;
      case 'ocr':
        return <DataExtraction />;
      case 'docprocessor':
        return <DocumentProcessor />;
      case 'usagelogs':
        return <UsageLogs />;
      case 'pipeline':
        return <ProcessingPipeline />;
      case 'boardresolutions':
        return <BoardResolutions />;
      case 'companyMandates':
        return <CompanyMandates />;
      case 'categories':
        return <CategoryManager />;
      case 'promptlibrary':
        return <PromptLibrary />;
      case 'knowledgesearch':
        return <KnowledgeSearch onNavigate={setActiveTab} />;
      case 'settings':
        return <Settings />;
      default:
        return <ProcedureQA />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="pt-[65px] sm:pt-[73px] lg:pl-20 min-h-screen">
        <div className="p-6">
          {renderContent()}
        </div>
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}

export default App;
