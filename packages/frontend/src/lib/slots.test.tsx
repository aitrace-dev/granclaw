import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  registerSlot, renderSlot, _resetSlotsForTests, _slotCountForTests,
} from './slots.js';

describe('UI slots', () => {
  beforeEach(() => _resetSlotsForTests());

  it('returns empty array when no renderers registered', () => {
    expect(renderSlot('integrations.cards', {})).toEqual([]);
  });

  it('counts registrations', () => {
    expect(_slotCountForTests('integrations.cards')).toBe(0);
    registerSlot('integrations.cards', () => null);
    expect(_slotCountForTests('integrations.cards')).toBe(1);
    registerSlot('integrations.cards', () => null);
    expect(_slotCountForTests('integrations.cards')).toBe(2);
  });

  it('renders registered components with props', () => {
    registerSlot<{ label: string }>('integrations.cards', ({ label }) => (
      <div data-testid="card">Card: {label}</div>
    ));

    render(<>{renderSlot('integrations.cards', { label: 'GoLogin' })}</>);

    expect(screen.getByTestId('card')).toHaveTextContent('Card: GoLogin');
  });

  it('renders multiple registrants in registration order', () => {
    registerSlot('integrations.cards', () => <span>A</span>);
    registerSlot('integrations.cards', () => <span>B</span>);
    registerSlot('integrations.cards', () => <span>C</span>);

    const { container } = render(<>{renderSlot('integrations.cards', {})}</>);

    expect(container.textContent).toBe('ABC');
  });

  it('slots are isolated by name', () => {
    registerSlot('integrations.cards', () => <span>card</span>);
    registerSlot('sidebar.items', () => <span>item</span>);

    expect(_slotCountForTests('integrations.cards')).toBe(1);
    expect(_slotCountForTests('sidebar.items')).toBe(1);
  });

  it('keys are unique per rendered item', () => {
    // If keys are missing React logs warnings to console.error. Spy and fail if any.
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };

    registerSlot('integrations.cards', () => <span>1</span>);
    registerSlot('integrations.cards', () => <span>2</span>);
    render(<>{renderSlot('integrations.cards', {})}</>);

    console.error = origError;
    const keyWarnings = errors.filter((e) => String(e).includes('unique "key"'));
    expect(keyWarnings).toHaveLength(0);
  });
});
