import { useState, useEffect } from 'react';

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

export function useClock(): string {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('zh-CN', TIME_FORMAT),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('zh-CN', TIME_FORMAT));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return time;
}
