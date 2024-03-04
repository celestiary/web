/**
 * Time controls
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createTimeSlice(set, get) {
  return {
    isTimeDialogVisible: false,
    setIsTimeDialogVisible: (is) => set((state) => ({isTimeDialogVisible: is})),
  }
}
