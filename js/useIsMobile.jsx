import useWindowDimensions from './useWindowDimensions'


/** @returns {boolean} True iff window width <= MOBILE_WIDTH */
export default function useIsMobile() {
  return useWindowDimensions().width <= 600
}
