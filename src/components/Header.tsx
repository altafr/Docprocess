import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getRandomMarket, getRandomJourney, BRAND_RED } from '@/lib/constants';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [userName] = useState('Arjun');
  const [market, setMarket] = useState('Singapore');
  const [journey, setJourney] = useState('CDD');
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    setMarket(getRandomMarket());
    setJourney(getRandomJourney());

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50">
      <div className="flex items-center justify-between px-3 sm:px-4 py-1">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden h-7 w-7"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#DB0011] flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 40 40" className="w-5 h-5">
                <rect width="18" height="18" fill="white" x="2" y="2" />
                <rect width="18" height="18" fill="white" x="20" y="2" />
                <rect width="18" height="18" fill="white" x="2" y="20" />
                <rect width="18" height="18" fill="white" x="20" y="20" />
                <rect width="6" height="6" fill="#DB0011" x="8" y="8" />
                <rect width="6" height="6" fill="#DB0011" x="26" y="8" />
                <rect width="6" height="6" fill="#DB0011" x="8" y="26" />
                <rect width="6" height="6" fill="#DB0011" x="26" y="26" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-semibold text-gray-900 truncate leading-tight">
                Welcome, {userName} &mdash; Commercial Banking {market} – {journey}
              </h1>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className="text-xs text-gray-600">
            {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {' '}
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </header>
  );
}
