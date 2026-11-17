import { describe, expect, it } from 'vitest';
import { passwordStrength } from './password';

describe('passwordStrength', () => {
  it('says nothing for an empty box', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });
  it('calls anything under 8 characters too short', () => {
    expect(passwordStrength('abc12')).toEqual({ score: 1, label: 'Too short' });
  });
  it('rates length and variety', () => {
    expect(passwordStrength('aaaaaaaa').label).toBe('Weak');
    expect(passwordStrength('correcthorse').label).toBe('Good');
    expect(passwordStrength('Correct-Horse-9').label).toBe('Strong');
  });
});
