// Lleva el elemento al <body> mientras está abierto. Las ventanas que viven
// dentro de una página quedan dentro de .content (el área que se desplaza) y
// en Safari de iPhone eso las deja por debajo de la barra de navegación aunque
// tengan un z-index más alto. Desde el <body> siempre quedan encima de todo.
import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({ selector: '[appSobreTodo]', standalone: true })
export class SobreTodoDirective implements OnInit, OnDestroy {
  private readonly el: HTMLElement = inject(ElementRef).nativeElement;

  ngOnInit(): void {
    document.body.appendChild(this.el);
  }

  ngOnDestroy(): void {
    this.el.remove();
  }
}
