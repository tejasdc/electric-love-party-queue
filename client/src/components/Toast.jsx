import { useEffect } from 'react';

function Toast({ message, isVisible, isError, onHide }) {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onHide();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onHide]);

  return (
    <div className={`toast ${isVisible ? 'show' : ''} ${isError ? 'error' : ''}`}>
      {message}
    </div>
  );
}

export default Toast;
