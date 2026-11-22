import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import axios from 'axios';
import TopProgressBar from '../components/common/TopProgressBar';
import { loadingProgress, trackRequests } from '../services/loadingProgress';

const bar = (container) => container.querySelector('.evsu-progress');
const width = (container) => parseFloat(container.querySelector('.evsu-progress__bar').style.width);

afterEach(() => {
  while (loadingProgress.getActive() > 0) loadingProgress.done();
  vi.useRealTimers();
});

describe('top progress bar', () => {
  it('stays hidden for loads that finish quickly', () => {
    vi.useFakeTimers();
    const { container } = render(<TopProgressBar />);
    act(() => loadingProgress.start());
    act(() => vi.advanceTimersByTime(100));
    act(() => loadingProgress.done());
    act(() => vi.advanceTimersByTime(1000));
    expect(bar(container)).not.toHaveClass('is-visible');
  });

  it('appears, creeps toward 90%, warns about a slow connection, then completes and fades', () => {
    vi.useFakeTimers();
    const { container } = render(<TopProgressBar />);
    act(() => loadingProgress.start());
    act(() => vi.advanceTimersByTime(200));
    expect(bar(container)).toHaveClass('is-visible');
    const early = width(container);
    act(() => vi.advanceTimersByTime(3000));
    expect(width(container)).toBeGreaterThan(early);
    expect(width(container)).toBeLessThan(90);
    expect(screen.queryByText(/connection may be slow/)).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole('status')).toHaveTextContent('Still loading. Your connection may be slow.');

    act(() => loadingProgress.done());
    expect(width(container)).toBe(100);
    expect(screen.queryByText(/connection may be slow/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(bar(container)).not.toHaveClass('is-visible');
  });

  it('counts each HTTP request once, success or failure', async () => {
    const client = axios.create();
    trackRequests(client);
    let release;
    client.defaults.adapter = (config) => new Promise((resolve) => { release = () => resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }); });
    const pending = client.get('/x');
    await vi.waitFor(() => expect(loadingProgress.getActive()).toBe(1));
    release();
    await pending;
    expect(loadingProgress.getActive()).toBe(0);

    client.defaults.adapter = (config) => Promise.reject(Object.assign(new Error('offline'), { config }));
    const failing = client.get('/y');
    await expect(failing).rejects.toThrow('offline');
    expect(loadingProgress.getActive()).toBe(0);
  });
});
