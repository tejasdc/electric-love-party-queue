import { useState, useCallback } from 'react';
import AnimatedBackground from './components/AnimatedBackground';
import NowPlaying from './components/NowPlaying';
import QueueList from './components/QueueList';
import SearchOverlay from './components/SearchOverlay';
import Toast from './components/Toast';
import { useNowPlaying } from './hooks/useNowPlaying';
import { useQueue } from './hooks/useQueue';
import './index.css';

function App() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [toast, setToast] = useState({ message: '', isVisible: false, isError: false });

  const { track: nowPlaying, isLoading: isNowPlayingLoading } = useNowPlaying();
  const { queue, isLoading: isQueueLoading, addToQueue } = useQueue();

  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isVisible: true, isError });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, isVisible: false }));
  }, []);

  const handleOpenSearch = () => {
    setIsSearchOpen(true);
  };

  const handleCloseSearch = () => {
    setIsSearchOpen(false);
  };

  const handleAddToQueue = async (uri) => {
    const result = await addToQueue(uri);

    if (result.success) {
      showToast('Added to queue!');
      return true;
    } else {
      showToast(result.error || 'Failed to add to queue', true);
      return false;
    }
  };

  return (
    <>
      {/* Animated Background */}
      <AnimatedBackground />

      {/* Main App */}
      <div className="app">
        <header className="header">
          <div className="header-spacer"></div>
          <h1 className="logo">Electric Love</h1>
          <button className="search-btn" onClick={handleOpenSearch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
          </button>
        </header>

        <main className="content">
          {/* Now Playing Section */}
          <NowPlaying track={nowPlaying} isLoading={isNowPlayingLoading} />

          {/* Queue Section */}
          <QueueList queue={queue} isLoading={isQueueLoading} />
        </main>
      </div>

      {/* Search Overlay */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={handleCloseSearch}
        onAddToQueue={handleAddToQueue}
      />

      {/* Toast Notifications */}
      <Toast
        message={toast.message}
        isVisible={toast.isVisible}
        isError={toast.isError}
        onHide={hideToast}
      />
    </>
  );
}

export default App;
