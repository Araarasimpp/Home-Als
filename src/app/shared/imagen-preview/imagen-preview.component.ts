import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SobreTodoDirective } from '../sobre-todo.directive';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-imagen-preview',
  standalone: true,
  // Encima de la barra de navegación también en iPhone
  hostDirectives: [SobreTodoDirective],
  imports: [CommonModule],
  templateUrl: './imagen-preview.component.html',
  styleUrls: ['./imagen-preview.component.scss'],
})
export class ImagenPreviewComponent {
  @Input() url: string | null = null;
  @Output() cerrar = new EventEmitter<void>();

  onCerrar(): void {
    this.cerrar.emit();
  }
}