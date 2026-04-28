import { ErrorBoundary, withErrorBoundary } from '../src/components/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError sets hasError and message', () => {
    const err = new Error('test crash');
    const state = ErrorBoundary.getDerivedStateFromError(err);
    expect(state.hasError).toBe(true);
    expect(state.errorMessage).toBe('test crash');
  });

  it('initial state has no error', () => {
    const instance = new ErrorBoundary({ children: null });
    expect(instance.state.hasError).toBe(false);
    expect(instance.state.errorMessage).toBeNull();
  });
});

describe('withErrorBoundary', () => {
  it('returns a component with displayName', () => {
    function TestComponent() { return null; }
    const Wrapped = withErrorBoundary(TestComponent);
    expect(Wrapped.displayName).toBe('withErrorBoundary(TestComponent)');
  });

  it('returns a callable component function', () => {
    function MyScreen() { return null; }
    const Wrapped = withErrorBoundary(MyScreen);
    expect(typeof Wrapped).toBe('function');
  });

  it('uses fallback displayName for anonymous components', () => {
    const Wrapped = withErrorBoundary(() => null);
    expect(Wrapped.displayName).toBe('withErrorBoundary(Component)');
  });
});
