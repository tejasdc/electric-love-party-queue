function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function QueueItem({ track, position, isNextUp }) {
  const defaultImage = 'https://i.scdn.co/image/ab67616d0000b273e8b066f70c206551210d902b';

  const albumImage = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || defaultImage;
  const trackName = track.name || 'Unknown Track';
  const artistName = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist';

  return (
    <div className={`queue-item ${isNextUp ? 'next-up' : ''}`}>
      <span className="queue-num">{position}</span>
      <div className="queue-thumb">
        <img src={albumImage} alt="" />
      </div>
      <div className="queue-info">
        <div className="queue-track">{trackName}</div>
        <div className="queue-artist">{artistName}</div>
      </div>
      <span className="queue-duration">{formatDuration(track.duration_ms)}</span>
    </div>
  );
}

function QueueList({ queue, isLoading }) {
  if (isLoading && (!queue || queue.length === 0)) {
    return (
      <section className="queue-section">
        <div className="section-header">
          <h3 className="section-title">Up Next</h3>
          <span className="queue-badge">Loading...</span>
        </div>
        <div className="loading-state">Loading queue...</div>
      </section>
    );
  }

  if (!queue || queue.length === 0) {
    return (
      <section className="queue-section">
        <div className="section-header">
          <h3 className="section-title">Up Next</h3>
          <span className="queue-badge">0 songs</span>
        </div>
        <div className="empty-state">
          <p>Queue is empty</p>
          <small>Search for songs to add to the party!</small>
        </div>
      </section>
    );
  }

  return (
    <section className="queue-section">
      <div className="section-header">
        <h3 className="section-title">Up Next</h3>
        <span className="queue-badge">{queue.length} {queue.length === 1 ? 'song' : 'songs'}</span>
      </div>

      <div className="queue-list">
        {queue.map((track, index) => (
          <QueueItem
            key={track.uri || `queue-${index}`}
            track={track}
            position={index + 1}
            isNextUp={index === 0}
          />
        ))}
      </div>
    </section>
  );
}

export default QueueList;
