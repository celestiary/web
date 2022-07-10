import {VRButton} from 'three/examples/jsm/webxr/VRButton.js'
import {XRControllerModelFactory} from 'three/examples/jsm/webxr/XRControllerModelFactory.js'


function init(renderer) {
  const vrButtonContainer = document.createElement('div')
  vrButtonContainer.setAttribute(
      'style',
      'width: 150px; font: 10px sans; position: absolute; bottom: -10px; left: 10px; text-align: center')
  const vrButton = VRButton.createButton(renderer)
  vrButtonContainer.appendChild(vrButton)
  const dismissButton = document.createElement('button')
  dismissButton.setAttribute(
      'style',
      'border: none; position: relative; bottom: 43px; left: 68px; opacity: 0.7; z-index: 1000')
  dismissButton.textContent = 'X'
  dismissButton.onclick = () => {
    vrButtonContainer.remove()
  }
  vrButtonContainer.appendChild(dismissButton)

  const controller = renderer.xr.getController(0)
  controller.addEventListener('selectstart', function() {
    this.userData.isSelecting = true
  })
  controller.addEventListener('selectend', function() {
    this.userData.isSelecting = false
  })
  controller.addEventListener('connected', function(event) {
    // TODO: buildController?
    // this.add(buildController(event.data));
  })
  controller.addEventListener('disconnected', function() {
    this.remove(this.children[0])
  })

  const controllerModelFactory = new XRControllerModelFactory()
  const controllerGrip = renderer.xr.getControllerGrip(0)
  controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
  return {vrButtonContainer, controller, controllerGrip}
}
