import { useState, useEffect, useRef, useCallback } from 'react';

function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function SearchItem({ track, onAdd, addingUri, wasAdded }) {
  const defaultImage = 'https://i.scdn.co/image/ab67616d0000b273e8b066f70c206551210d902b';

  const albumImage = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || defaultImage;
  const trackName = track.name || 'Unknown Track';
  const artistName = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
  const albumName = track.album?.name || '';

  const isLoading = addingUri === track.uri;

  const handleAdd = (e) => {
    e.stopPropagation();
    if (isLoading || wasAdded) return;

    onAdd(track.uri);
  };

  return (
    <div className="search-item">
      <div className="search-thumb">
        <img src={albumImage} alt="" />
      </div>
      <div className="search-info">
        <div className="search-track">{trackName}</div>
        <div className="search-meta">{artistName} {albumName && `\u00B7 ${albumName}`}</div>
      </div>
      <button
        className={`add-btn ${isLoading ? 'loading' : ''} ${wasAdded ? 'added' : ''}`}
        onClick={handleAdd}
      >
        <span>{wasAdded ? '\u2713' : isLoading ? '\u25CB' : '+'}</span>
      </button>
    </div>
  );
}

function SearchOverlay({ isOpen, onClose, onAddToQueue }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingUri, setAddingUri] = useState(null);
  const [addedUris, setAddedUris] = useState(new Set());
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input when overlay opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Clear results when overlay closes
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setAddedUris(new Set());
    }
  }, [isOpen]);

  // Debounced search
  const performSearch = useCallback(async (searchQuery) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setResults(data.tracks || []);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle input change with debounce
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);

    // Clear existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Set new timeout for search
    debounceRef.current = setTimeout(() => {
      performSearch(value);
    }, 300);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Handle add to queue
  const handleAdd = async (uri) => {
    setAddingUri(uri);
    try {
      const success = await onAddToQueue(uri);
      if (success) {
        setAddedUris(prev => new Set([...prev, uri]));
      }
    } finally {
      setAddingUri(null);
    }
  };

  // Handle keyboard events
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className={`search-overlay ${isOpen ? 'open' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <div className="search-header">
        <button className="search-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
        <div className="search-input-wrap">
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            className="search-input"
            placeholder="Find a song..."
            value={query}
            onChange={handleInputChange}
          />
        </div>
      </div>

      <div className="search-results">
        {isSearching && (
          <div className="loading-state">Searching...</div>
        )}

        {!isSearching && query && results.length === 0 && (
          <div className="search-empty">
            <p>No results found</p>
            <small>Try a different search term</small>
          </div>
        )}

        {!isSearching && !query && (
          <div className="search-empty">
            <p>Search for songs</p>
            <small>Type to find tracks to add to the queue</small>
          </div>
        )}

        {!isSearching && results.map((track, index) => (
          <SearchItem
            key={track.uri || `search-${index}`}
            track={track}
            onAdd={handleAdd}
            addingUri={addingUri}
            wasAdded={addedUris.has(track.uri)}
          />
        ))}
      </div>
    </div>
  );
}

export default SearchOverlay;
