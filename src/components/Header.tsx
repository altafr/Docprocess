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
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DB0011] flex items-center justify-center">
              <svg viewBox="0 0 40 40" className="w-8 h-8">
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
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Welcome, {userName}
              </h1>
              <p className="text-sm text-gray-600">
                Commercial Banking {market} – {journey}
              </p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">
            {currentTime.toLocaleDateString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </p>
          <p className="text-sm text-gray-600">
            {currentTime.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </p>
        </div>
      </div>
    </header>
  );
}
