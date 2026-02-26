package io.snapshot;

import java.lang.annotation.*;

@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.METHOD)
public @interface IOSnapshot {
    String value() default "";
}
