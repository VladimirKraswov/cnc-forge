# Core Architecture

The CNC controller is designed with a layered architecture to ensure separation of concerns, reliability, and ease of maintenance.

```
   Application Layer (CLI/GUI/Web)
         ↓
      API Layer (pure methods, events)
         ↓
    Core Layer (business logic, G-code)
         ↓
   Adapter Layer (Serial/WiFi/Bluetooth)
         ↓
    Hardware Layer (GRBL/machine)
```
