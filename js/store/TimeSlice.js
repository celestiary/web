/**
 * Time controls
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createTimeSlice(set, get) {
  return {
    isDatePickerVisible: false,
    setIsDatePickerVisible: (is) => set((state) => ({isDatePickerVisible: is})),
  }
}
