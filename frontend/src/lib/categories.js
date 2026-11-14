// The provider categories. Keep in step with CATEGORIES in backend/app/schemas/provider.py.
export const CATEGORIES = [
  { value: 'dentist', label: 'Dentist' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'therapist', label: 'Therapist' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'salon', label: 'Salon and barber' },
  { value: 'legal', label: 'Legal' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'other', label: 'Other' },
];

export const categoryLabel = (value) => CATEGORIES.find((c) => c.value === value)?.label ?? 'Other';

export const isCategory = (value) => CATEGORIES.some((c) => c.value === value);
