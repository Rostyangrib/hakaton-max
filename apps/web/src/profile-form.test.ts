import { describe, expect, it } from 'vitest';

import type { ResidentProfile } from '@quiet-chat/shared';

import { fromProfile } from './App.js';

describe('fromProfile form state conversion', () => {
  it('returns empty strings for null profile', () => {
    const form = fromProfile(null);
    expect(form.apartment).toBe('');
    expect(form.entrance).toBe('');
    expect(form.floor).toBe('');
    expect(form.vehicles).toEqual([{ plate: '', description: '' }]);
    expect(form.alertsEnabled).toBe(true);
  });

  it('returns empty strings for undefined profile', () => {
    const form = fromProfile(undefined);
    expect(form.apartment).toBe('');
    expect(form.entrance).toBe('');
    expect(form.floor).toBe('');
    expect(form.vehicles).toEqual([{ plate: '', description: '' }]);
  });

  it('never yields literal "undefined" or "null" when fields are undefined or null', () => {
    const incompleteProfile = {
      apartment: undefined as unknown as number,
      entrance: null as unknown as number,
      floor: undefined,
      alertsEnabled: false,
    } as unknown as ResidentProfile;

    const form = fromProfile(incompleteProfile);
    expect(form.apartment).toBe('');
    expect(form.entrance).toBe('');
    expect(form.floor).toBe('');
    expect(form.apartment).not.toBe('undefined');
    expect(form.entrance).not.toBe('null');
    expect(form.floor).not.toBe('undefined');
    expect(form.alertsEnabled).toBe(false);
  });

  it('correctly maps filled profile values to strings', () => {
    const filledProfile: ResidentProfile = {
      apartment: 54,
      entrance: 3,
      floor: 8,
      carPlate: 'А123ВС77',
      carDescription: 'Camry',
      properties: [],
      vehicles: [{ plate: 'А123ВС77', description: 'Camry' }],
      alertsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    const form = fromProfile(filledProfile);
    expect(form.apartment).toBe('54');
    expect(form.entrance).toBe('3');
    expect(form.floor).toBe('8');
    expect(form.vehicles).toEqual([{ plate: 'А123ВС77', description: 'Camry' }]);
    expect(form.alertsEnabled).toBe(true);
  });

  it('produces distinct object instances and does not mutate shared state', () => {
    const form1 = fromProfile(null);
    const form2 = fromProfile(null);
    expect(form1).not.toBe(form2);
    expect(form1.vehicles).not.toBe(form2.vehicles);

    form1.apartment = '99';
    form1.vehicles[0]!.plate = 'TEST';
    expect(form2.apartment).toBe('');
    expect(form2.vehicles[0]!.plate).toBe('');
  });

  it('filters out literal strings "undefined", "null", and "NaN" across all fields and vehicles', () => {
    const corruptedProfile = {
      apartment: 'undefined' as unknown as number,
      entrance: 'null' as unknown as number,
      floor: 'NaN' as unknown as number,
      carPlate: 'undefined',
      carDescription: 'null',
      vehicles: [
        { plate: 'undefined', description: 'null' },
        { plate: 'null', description: 'undefined' },
      ],
      alertsEnabled: true,
    } as unknown as ResidentProfile;

    const form = fromProfile(corruptedProfile);
    expect(form.apartment).toBe('');
    expect(form.entrance).toBe('');
    expect(form.floor).toBe('');
    expect(form.vehicles).toEqual([
      { plate: '', description: '' },
      { plate: '', description: '' },
    ]);
  });
});

